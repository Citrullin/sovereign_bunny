#!/usr/bin/env bash
# ============================================================================
#  sign_booklet.sh -- Cryptographic signing tool for whitebooklet PDF
#
#  Supports:
#    1. Sigstore Cosign (default / recommended: keyless OIDC or key-based)
#    2. Minisign (ed25519)
#    3. GnuPG (OpenPGP detach-sign)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$REPO_ROOT/docs/booklet/dist"
PDF_FILE="$DIST_DIR/sovereign-booklet.pdf"
CHECKSUM_FILE="$DIST_DIR/SHA256SUMS"

if [ ! -f "$PDF_FILE" ]; then
    echo "Error: PDF file not found at $PDF_FILE" >&2
    echo "Build the booklet on \$REMOTE_HOST (make -C docs/booklet pdf) and sync to docs/booklet/dist/ first." >&2
    exit 1
fi

(cd "$DIST_DIR" && sha256sum sovereign-booklet.pdf > SHA256SUMS)
echo "Integrity hash: $(cat "$CHECKSUM_FILE")"

SIGN_MODE="${SIGN_MODE:-auto}"

if [ "$SIGN_MODE" = "auto" ]; then
    if command -v cosign >/dev/null 2>&1; then
        SIGN_MODE="cosign"
    elif command -v minisign >/dev/null 2>&1; then
        SIGN_MODE="minisign"
    elif command -v gpg >/dev/null 2>&1; then
        SIGN_MODE="gpg"
    else
        echo "Error: None of cosign, minisign, or gpg was found in PATH." >&2
        echo "Please install cosign or minisign to sign the booklet." >&2
        exit 1
    fi
fi

case "$SIGN_MODE" in
    cosign)
        echo "=== Signing PDF with Sigstore Cosign ==="
        if [ -n "${COSIGN_KEY:-}" ]; then
            cosign sign-blob \
                --key "$COSIGN_KEY" \
                --bundle "$DIST_DIR/sovereign-booklet.pdf.bundle" \
                "$PDF_FILE"
        else
            echo "Using keyless OIDC signing (requires browser login / interactive or GitHub Actions token)..."
            cosign sign-blob \
                --bundle "$DIST_DIR/sovereign-booklet.pdf.bundle" \
                "$PDF_FILE"
        fi
        echo "Signature bundle created: $DIST_DIR/sovereign-booklet.pdf.bundle"
        echo "Verification command:"
        echo "  cosign verify-blob --bundle $DIST_DIR/sovereign-booklet.pdf.bundle $PDF_FILE"
        ;;
    minisign)
        echo "=== Signing PDF with Minisign ==="
        MINISIGN_SECRET_KEY="${MINISIGN_SECRET_KEY:-$HOME/.minisign/minisign.key}"
        if [ ! -f "$MINISIGN_SECRET_KEY" ]; then
            echo "Error: Minisign secret key not found at $MINISIGN_SECRET_KEY" >&2
            exit 1
        fi
        minisign -Sm "$PDF_FILE" -s "$MINISIGN_SECRET_KEY"
        echo "Signature created: $PDF_FILE.minisig"
        echo "Verification command:"
        echo "  minisign -Vm $PDF_FILE -p <public-key-file>"
        ;;
    gpg)
        echo "=== Signing PDF with GnuPG ==="
        gpg --armor --detach-sign --output "$PDF_FILE.asc" "$PDF_FILE"
        echo "Signature created: $PDF_FILE.asc"
        echo "Verification command:"
        echo "  gpg --verify $PDF_FILE.asc $PDF_FILE"
        ;;
    *)
        echo "Unknown SIGN_MODE: $SIGN_MODE (expected cosign, minisign, or gpg)" >&2
        exit 1
        ;;
esac

echo "=== Booklet successfully signed ==="
