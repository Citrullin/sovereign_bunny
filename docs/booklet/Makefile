# ============================================================================
#  Makefile -- Reproducible build pipeline for "Friction by Design" booklet
#
#  NOTE: Per project policy, local builds are disabled. Execute on $REMOTE_HOST
#        via SSH or containerized CI.
# ============================================================================

BUILD_DIR ?= build
DIST_DIR  ?= dist
SRC       := sovereign-booklet.tex references.bib
PAPERS    := radicle-economic-case bunny-hive sovereign-bunny bunny-stack

BOOKLET_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "uncommitted")
BOOKLET_DATE   ?= $(shell git log -1 --format=%cs 2>/dev/null || date -u +%Y-%m-%d)
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || date +%s)
export SOURCE_DATE_EPOCH
export FORCE_SOURCE_DATE = 1

.PHONY: all pdf pdf-ci radicle-pdf papers sha256 docker-pdf clean

all: pdf papers sha256

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(DIST_DIR):
	mkdir -p $(DIST_DIR)

$(BUILD_DIR)/meta.tex: | $(BUILD_DIR)
	@printf '%% Auto-generated build metadata\n\\newcommand{\\bookletcommit}{%s}\n\\newcommand{\\bookletdate}{%s}\n' "$(BOOKLET_COMMIT)" "$(BOOKLET_DATE)" > $@

pdf: $(BUILD_DIR)/meta.tex | $(DIST_DIR)
	@if command -v latexmk >/dev/null 2>&1; then \
		echo "Building Sovereign Booklet with latexmk..."; \
		latexmk -pdf -bibtex-cond1 -interaction=nonstopmode -halt-on-error \
			-outdir=$(BUILD_DIR) sovereign-booklet.tex && \
		cp $(BUILD_DIR)/sovereign-booklet.pdf $(DIST_DIR)/sovereign-booklet.pdf; \
	elif command -v docker >/dev/null 2>&1; then \
		echo "latexmk not found. Falling back to container build..."; \
		$(MAKE) docker-pdf; \
	else \
		echo "Error: neither latexmk nor docker is available in PATH." >&2; \
		exit 1; \
	fi

pdf-ci: $(BUILD_DIR)/meta.tex | $(DIST_DIR)
	latexmk -pdf -bibtex-cond1 -interaction=nonstopmode -halt-on-error \
		-outdir=$(BUILD_DIR) sovereign-booklet.tex
	cp $(BUILD_DIR)/sovereign-booklet.pdf $(DIST_DIR)/sovereign-booklet.pdf
	$(MAKE) papers
	$(MAKE) sha256

# Component papers (self-contained, shared common-preamble.tex, no bibtex)
papers: $(BUILD_DIR)/meta.tex | $(DIST_DIR)
	for p in $(PAPERS); do \
		latexmk -pdf -interaction=nonstopmode -halt-on-error \
			-jobname=$$p -outdir=$(BUILD_DIR) $$p.tex || exit 1; \
		cp $(BUILD_DIR)/$$p.pdf $(DIST_DIR)/$$p.pdf; \
	done

radicle-pdf: papers

docker-pdf: $(BUILD_DIR)/meta.tex | $(DIST_DIR)
	docker run --rm \
		--user "$$(id -u):$$(id -g)" \
		-e SOURCE_DATE_EPOCH=$(SOURCE_DATE_EPOCH) \
		-e FORCE_SOURCE_DATE=1 \
		-v "$$(pwd):/work" \
		-w /work \
		texlive/texlive:latest \
		sh -c "latexmk -pdf -bibtex-cond1 -interaction=nonstopmode -halt-on-error -outdir=$(BUILD_DIR) sovereign-booklet.tex"
	cp $(BUILD_DIR)/sovereign-booklet.pdf $(DIST_DIR)/sovereign-booklet.pdf

sha256: $(DIST_DIR)/sovereign-booklet.pdf $(foreach p,$(PAPERS),$(DIST_DIR)/$(p).pdf)
	cd $(DIST_DIR) && sha256sum sovereign-booklet.pdf $(foreach p,$(PAPERS),$(p).pdf) > SHA256SUMS
	@echo "SHA256 checksums generated at $(DIST_DIR)/SHA256SUMS"

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
