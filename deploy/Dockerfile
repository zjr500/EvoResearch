FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements-lock.txt .
RUN pip install --no-cache-dir -r requirements-lock.txt setuptools wheel
COPY . .
RUN pip install --no-deps --no-build-isolation ./packages/autoresearch .
ENV PYTHONPATH=/app/apps/workbench
CMD ["python", "apps/workbench/server.py"]
