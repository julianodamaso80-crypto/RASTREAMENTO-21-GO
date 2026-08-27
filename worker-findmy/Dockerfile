FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY findmy_crypto.py decoder_client.py worker.py ./

# Sem buffer: log aparece no docker logs na hora, não quando o buffer enche.
ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]
