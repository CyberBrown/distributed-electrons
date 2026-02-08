"""
Spark Gateway -- GPU and service visibility for Distributed Electrons.

Runs on DGX Spark, exposed via Cloudflare Tunnel.
DE queries this to make waterfall routing decisions.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone
import subprocess
import asyncio
import httpx
from typing import Optional

app = FastAPI(title="Spark Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Service Registry ---------------------------------------------------------
# Define all services that can run on Spark.
# Each entry maps a service name to its container name, port, and health endpoint.

SERVICES = {
    "nemotron": {
        "container": "vllm-nemotron",
        "port": 8000,
        "health": "/health",
        "type": "llm",
        "description": "Nemotron via vLLM",
        "vram_gb": 16,
    },
    "comfyui": {
        "container": "comfyui-optimized",
        "port": 8188,
        "health": "/",
        "type": "image-generation",
        "description": "ComfyUI image generation",
        "vram_gb": 8,
    },
    "claude-runner": {
        "container": "claude-runner",
        "port": 8789,
        "health": "/health",
        "type": "code-runner",
        "description": "Claude Code agent runner",
        "vram_gb": 0,
    },
    "gemini-runner": {
        "container": "gemini-runner",
        "port": 8790,
        "health": "/health",
        "type": "code-runner",
        "description": "Gemini agent runner",
        "vram_gb": 0,
    },
    # Add new services here as we build them:
    # "rmbg": { "container": "rmbg", "port": 8001, "health": "/health",
    #           "type": "image-processing", "vram_gb": 2 },
    # "real-esrgan": { "container": "esrgan", "port": 8002, "health": "/health",
    #                  "type": "image-processing", "vram_gb": 4 },
}


# --- GPU Status ---------------------------------------------------------------

class GPUStatus(BaseModel):
    gpu_name: str
    gpu_utilization_pct: int
    memory_used_mb: int
    memory_total_mb: int
    memory_free_mb: int
    memory_utilization_pct: float
    temperature_c: int
    power_draw_w: float
    processes: list[dict]


@app.get("/gpu")
async def get_gpu_status() -> GPUStatus:
    """Current GPU utilization, memory, temperature, running processes."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,"
                "memory.free,temperature.gpu,power.draw",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        parts = [p.strip() for p in result.stdout.strip().split(",")]

        def safe_int(val: str, default: int = 0) -> int:
            """Parse int, returning default for [N/A] or invalid values."""
            if val in ("[N/A]", "N/A", "Not Supported", ""):
                return default
            try:
                return int(val)
            except ValueError:
                return default

        def safe_float(val: str, default: float = 0.0) -> float:
            """Parse float, returning default for [N/A] or invalid values."""
            if val in ("[N/A]", "N/A", "Not Supported", ""):
                return default
            try:
                return float(val)
            except ValueError:
                return default

        # Get running processes
        proc_result = subprocess.run(
            [
                "nvidia-smi",
                "--query-compute-apps=pid,used_gpu_memory,process_name",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        processes = []
        if proc_result.stdout.strip():
            for line in proc_result.stdout.strip().split("\n"):
                proc_parts = [p.strip() for p in line.split(",")]
                if len(proc_parts) >= 3:
                    processes.append({
                        "pid": safe_int(proc_parts[0]),
                        "gpu_memory_mb": safe_int(proc_parts[1]),
                        "process_name": proc_parts[2],
                    })

        mem_used = safe_int(parts[2])
        mem_total = safe_int(parts[3])

        return GPUStatus(
            gpu_name=parts[0],
            gpu_utilization_pct=safe_int(parts[1]),
            memory_used_mb=mem_used,
            memory_total_mb=mem_total,
            memory_free_mb=safe_int(parts[4]),
            memory_utilization_pct=(
                round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0
            ),
            temperature_c=safe_int(parts[5]),
            power_draw_w=safe_float(parts[6]),
            processes=processes,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"nvidia-smi failed: {e}")


# --- Service Status -----------------------------------------------------------

class ServiceStatus(BaseModel):
    name: str
    type: str
    container_running: bool
    healthy: bool
    port: int
    vram_gb: int
    description: str
    response_time_ms: Optional[float] = None
    error: Optional[str] = None


@app.get("/services")
async def list_services() -> dict:
    """List all registered services with their current status."""
    statuses: dict[str, ServiceStatus] = {}
    async with httpx.AsyncClient(timeout=3.0) as client:
        tasks = {
            name: _check_service(client, name, svc)
            for name, svc in SERVICES.items()
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for name, result in zip(tasks.keys(), results):
            if isinstance(result, Exception):
                svc = SERVICES[name]
                statuses[name] = ServiceStatus(
                    name=name,
                    type=svc["type"],
                    container_running=False,
                    healthy=False,
                    port=svc["port"],
                    vram_gb=svc["vram_gb"],
                    description=svc["description"],
                    error=str(result),
                )
            else:
                statuses[name] = result

    return {
        "services": {k: v.model_dump() for k, v in statuses.items()},
        "summary": {
            "total": len(statuses),
            "healthy": sum(1 for s in statuses.values() if s.healthy),
            "running": sum(1 for s in statuses.values() if s.container_running),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def _check_service(
    client: httpx.AsyncClient, name: str, svc: dict
) -> ServiceStatus:
    """Check if a service container is running and healthy."""
    container_running = _is_container_running(svc["container"])

    if not container_running:
        return ServiceStatus(
            name=name,
            type=svc["type"],
            container_running=False,
            healthy=False,
            port=svc["port"],
            vram_gb=svc["vram_gb"],
            description=svc["description"],
        )

    # Container is running, check health endpoint
    start = asyncio.get_event_loop().time()
    try:
        resp = await client.get(f"http://localhost:{svc['port']}{svc['health']}")
        elapsed = (asyncio.get_event_loop().time() - start) * 1000
        return ServiceStatus(
            name=name,
            type=svc["type"],
            container_running=True,
            healthy=resp.status_code < 400,
            port=svc["port"],
            vram_gb=svc["vram_gb"],
            description=svc["description"],
            response_time_ms=round(elapsed, 1),
        )
    except Exception as e:
        return ServiceStatus(
            name=name,
            type=svc["type"],
            container_running=True,
            healthy=False,
            port=svc["port"],
            vram_gb=svc["vram_gb"],
            description=svc["description"],
            error=str(e),
        )


def _is_container_running(container_name: str) -> bool:
    """Check if a Docker container is running."""
    try:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", container_name],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.stdout.strip().lower() == "true"
    except Exception:
        return False


@app.get("/services/{name}")
async def get_service(name: str) -> ServiceStatus:
    """Get status of a specific service."""
    if name not in SERVICES:
        raise HTTPException(status_code=404, detail=f"Unknown service: {name}")

    svc = SERVICES[name]
    async with httpx.AsyncClient(timeout=3.0) as client:
        return await _check_service(client, name, svc)


# --- Availability Check (for DE waterfall) ------------------------------------

class AvailabilityResponse(BaseModel):
    available: bool
    service: str
    reason: str
    gpu_memory_free_mb: int
    gpu_utilization_pct: int
    recommendation: str  # "use_local", "use_cloud", "queue"


@app.get("/available/{service_type}")
async def check_availability(
    service_type: str, mode: str = "waterfall"
) -> AvailabilityResponse:
    """
    DE calls this before routing a request.
    Returns whether local service is available + recommendation.

    service_type: "llm", "image-generation", "image-processing", "code-runner"
    mode: "waterfall" (need answer now) or "queue" (can wait)
    """
    # Get GPU status
    try:
        gpu = await get_gpu_status()
    except Exception:
        return AvailabilityResponse(
            available=False,
            service=service_type,
            reason="Cannot reach GPU (nvidia-smi failed)",
            gpu_memory_free_mb=0,
            gpu_utilization_pct=100,
            recommendation="use_cloud",
        )

    # Find services matching the requested type
    matching = {
        name: svc
        for name, svc in SERVICES.items()
        if svc["type"] == service_type
    }

    if not matching:
        return AvailabilityResponse(
            available=False,
            service=service_type,
            reason=f"No registered service of type '{service_type}'",
            gpu_memory_free_mb=gpu.memory_free_mb,
            gpu_utilization_pct=gpu.gpu_utilization_pct,
            recommendation="use_cloud",
        )

    # Check if any matching service is running and healthy
    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, svc in matching.items():
            status = await _check_service(client, name, svc)
            if status.healthy:
                return AvailabilityResponse(
                    available=True,
                    service=name,
                    reason=(
                        f"{name} is running and healthy"
                        f" ({status.response_time_ms}ms)"
                    ),
                    gpu_memory_free_mb=gpu.memory_free_mb,
                    gpu_utilization_pct=gpu.gpu_utilization_pct,
                    recommendation="use_local",
                )

    # No healthy service found
    if mode == "queue":
        return AvailabilityResponse(
            available=False,
            service=service_type,
            reason=f"No healthy {service_type} service, but can queue",
            gpu_memory_free_mb=gpu.memory_free_mb,
            gpu_utilization_pct=gpu.gpu_utilization_pct,
            recommendation="queue",
        )

    return AvailabilityResponse(
        available=False,
        service=service_type,
        reason=f"No healthy {service_type} service available",
        gpu_memory_free_mb=gpu.memory_free_mb,
        gpu_utilization_pct=gpu.gpu_utilization_pct,
        recommendation="use_cloud",
    )


# --- Health -------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
