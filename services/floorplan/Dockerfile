FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
ENV PYTHONUNBUFFERED=1 FLOORPLAN_ENGINE=cubicasa5k FLOORPLAN_BIND_HOST=0.0.0.0 FLOORPLAN_DEVICE=cpu
COPY requirements.txt ./
RUN pip install --no-cache-dir torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY app.py pipeline.py colored_walls.py annotations.py mitunet_pipeline.py download_mitunet.py download_model.py MODEL-NOTICES.md ./
COPY vendor ./vendor
RUN python download_model.py
EXPOSE 8765
CMD ["python", "app.py", "--host", "0.0.0.0", "--port", "8765"]
