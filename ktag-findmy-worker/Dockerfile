FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY findmy_worker/ ./findmy_worker/

VOLUME ["/data/outbox", "/data/sessao-apple"]

CMD ["python", "-m", "findmy_worker.main"]
