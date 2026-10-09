# Standalone demo "site" publisher — a separate process from the backend.
# Simulates an edge site behind NAT: opens OUTBOUND RTSP connections
# to MediaMTX and pushes demo video, like a real customer device.
FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY publisher.mjs .

CMD ["node", "publisher.mjs"]
