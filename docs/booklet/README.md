# Friction by Design: A Cipherpunk Whitebooklet

This directory contains the formal LaTeX whitebooklet specifying the economic incentive structure, security invariants, cryptographic primitives, and physical network layer for Sovereign Reth.

## Document Structure

- **`sovereign-booklet.tex`**: The primary LaTeX document (KOMA-Script `scrartcl`, BibLaTeX/Biber, TikZ).
- **`references.bib`**: BibLaTeX bibliography containing all legal, academic, economic, and technical references.
- **`Makefile`**: Reproducible compilation pipeline with `SOURCE_DATE_EPOCH` pinning.
- **`build/`**: Intermediate LaTeX engine output (git-ignored).
- **`dist/`**: Final deliverables including `sovereign-booklet.pdf`, `SHA256SUMS`, and cryptographic signature bundles (git-ignored).

---

## Build Prerequisites & Tooling

Depending on whether you are compiling on `$REMOTE_HOST` or inspecting locally:

- **Remote Build Host (`$REMOTE_HOST`)**:
  - `latexmk` (automatic PDF LaTeX engine runner)
  - `biber` (BibLaTeX bibliography compiler)
  - TeX Live packages: `texlive-latex-extra`, `texlive-science`, `texlive-fonts-extra`, `lmodern`
  - Containerized fallback: Docker (`texlive/texlive:latest`) if native TeX Live is absent.
- **Local Developer Workstation**:
  - `rsync`, `ssh`, `sha256sum` (used by `scripts/build_booklet_remote.sh`)
  - `poppler-utils` (`pdftoppm`): Required for rendering PDF pages to high-resolution PNGs during visual layout verification and local review (`sudo apt install poppler-utils`).
  - `cosign`, `minisign`, or `gpg`: Required for cryptographic signing of release bundles.

---

## Remote Build Instructions

> [!IMPORTANT]
> **Workspace Build Rule (`GEMINI.md`)**: Local compilation of TeX/Rust is strictly disabled on developer machines. All compilation must be executed on the remote target host (`$REMOTE_HOST`) or via remote container pipelines.

### Option 1: Automated Remote Build (Recommended)

Ensure `REMOTE_HOST` is exported in your environment or configured in `scripts/cluster.env`:

```bash
export REMOTE_HOST=root@your-remote-host
./scripts/build_booklet_remote.sh
```

This script:
1. Syncs `docs/booklet/` to `$REMOTE_HOST:$REMOTE_DIR/docs/booklet/`
2. Executes `make pdf-ci` on the remote target
3. Pulls `sovereign-booklet.pdf`, component papers, and `SHA256SUMS` into `docs/booklet/dist/`
4. Validates local SHA256 integrity

### Option 2: Running directly on `$REMOTE_HOST`

If logged into the remote host:

```bash
cd docs/booklet
make pdf
```

If `latexmk` is not installed on the remote host, `make pdf` automatically falls back to containerized `docker run ... texlive/texlive:latest`.

---

## Cryptographic Signing & Verification

Once `docs/booklet/dist/sovereign-booklet.pdf` is retrieved from the remote builder, sign it with:

```bash
./scripts/sign_booklet.sh
```

### Supported Signing Backends

1. **Sigstore Cosign (Default / Recommended)**:
   - Uses keyless OIDC transparency log attestation or private key:
     ```bash
     # Keyless interactive signing:
     cosign sign-blob --bundle docs/booklet/dist/sovereign-booklet.pdf.bundle docs/booklet/dist/sovereign-booklet.pdf
     ```
2. **Minisign**:
   ```bash
   minisign -Sm docs/booklet/dist/sovereign-booklet.pdf -s ~/.minisign/minisign.key
   ```
3. **GnuPG**:
   ```bash
   gpg --armor --detach-sign docs/booklet/dist/sovereign-booklet.pdf
   ```

### Verification

To verify the signed PDF:

```bash
# 1. Verify SHA-256 integrity:
cd docs/booklet/dist
sha256sum -c SHA256SUMS

# 2. Verify Cosign bundle:
cosign verify-blob \
  --certificate-identity "<signer-identity>" \
  --certificate-oidc-issuer "<oidc-issuer-url>" \
  --bundle sovereign-booklet.pdf.bundle \
  sovereign-booklet.pdf
```

---

## Document set

| Source | Role |
|---|---|
| `sovereign-booklet.tex` | The circular cryptographic economy (includes multi-seed MeritRank and relationship-native authority) |
| `sovereign-bunny.tex` | Ledger component paper (skeleton, migration map) |
| `bunny-stack.tex` | Packaging / runtime / deployment component paper (skeleton) |
| `bunny-hive.tex` | Institutional layer + scene-graph resolver implementation plan (planned) |
| `radicle-economic-case.tex` | Standalone critique of Radicle's network sovereignty; ledger optional |
| `common-preamble.tex` | Shared preamble for every paper except the base booklet |

`make papers` builds all component papers; `make pdf-ci` builds everything and writes `dist/SHA256SUMS`.
