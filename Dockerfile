FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SAMPLE_DATA=0 NEXT_PUBLIC_API_BASE=""
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app/backend
ENV SIGNAL_PUBLIC_JUDGE_ACCESS=true
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 SIGNAL_STATIC_DIR=/app/frontend/out
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --no-create-home --uid 10001 signal
COPY backend/signal_app ./signal_app
COPY --from=frontend /app/frontend/out /app/frontend/out
USER signal
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn signal_app.main:app --host 0.0.0.0 --port \"${PORT:-10000}\""]
