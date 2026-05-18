"""FastAPI backend."""

import os

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routers.business import router as business_router
from backend.routers.cash_flow import router as cash_flow_router
from backend.routers.categories import router as categories_router
from backend.routers.investments import router as investments_router
from backend.routers.manual_transactions import router as manual_transactions_router
from backend.routers.overview import router as overview_router
from backend.routers.settings import router as settings_router
from backend.routers.transactions import router as transactions_router
from backend.routers.travel import router as travel_router

app = FastAPI(title="Family Money Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_API_SECRET = os.getenv("API_SECRET")


@app.middleware("http")
async def require_api_secret(request: Request, call_next):
    if _API_SECRET and request.url.path != "/health":
        if request.headers.get("X-API-Secret") != _API_SECRET:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)

app.include_router(business_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(manual_transactions_router, prefix="/api")
app.include_router(overview_router, prefix="/api")
app.include_router(cash_flow_router, prefix="/api")
app.include_router(investments_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(transactions_router, prefix="/api")
app.include_router(travel_router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8083, reload=True)
