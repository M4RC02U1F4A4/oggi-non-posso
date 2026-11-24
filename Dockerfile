# syntax=docker/dockerfile:1

# One image for both halves: the frontend is built to static files, the
# backend to a static binary that serves them next to the API.

FROM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
# Pure Go with cgo off: the binary needs nothing from the build image.
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" \
      -o /out/oggi-non-posso ./cmd/oggi-non-posso
# The data directory must exist and belong to the runtime user, or a run
# without a volume could not create the database.
RUN mkdir -p /out/data

# distroless/static: no shell, no package manager.
FROM gcr.io/distroless/static:nonroot
COPY --from=backend --chown=65532:65532 /out/data /data
COPY --from=backend /out/oggi-non-posso /oggi-non-posso
COPY --from=frontend /src/dist /app/static
ENV ONP_LISTEN=:8080 \
    ONP_DB_PATH=/data/oggi-non-posso.db \
    ONP_STATIC_DIR=/app/static
# Numeric, so that an orchestrator can verify the process is not root.
USER 65532:65532
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/oggi-non-posso"]
