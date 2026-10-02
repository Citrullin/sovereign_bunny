# Build stage using Debian Trixie (matches remote mgmtsrv)
FROM debian:trixie-slim AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    clang \
    protobuf-compiler \
    mold \
    binutils \
    lld \
    curl \
    git \
    cmake \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain matching workspace
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.98.1
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build
COPY . .

# Build sovereign-bunny binary with high performance mold linker
RUN cargo build --release -p sovereign-node --bin sovereign-bunny

# Runtime stage
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/sovereign-bunny /usr/local/bin/sovereign-bunny

EXPOSE 8545 8546 9001 30303

ENTRYPOINT ["sovereign-bunny"]
CMD ["node", "--http", "--http.addr", "0.0.0.0", "--http.port", "8545"]
