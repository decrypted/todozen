# Distribution files (single source of truth)
JS_FILES = extension.js manager.js history.js prefs.js utils.js
STATIC_FILES = metadata.json stylesheet.css prefs.ui
EXTENSION_FILES = $(JS_FILES) $(STATIC_FILES) build-info.json

# Extension info
UUID = todozen@irtesaam.github.io
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: start
start:
	dbus-run-session -- gnome-shell --nested --wayland

# build schema
.PHONY: schemas
schemas:
	rm ./schemas/gschemas.compiled -f
	glib-compile-schemas ./schemas

# build ts
.PHONY: build
build:
	yarn build
	@echo '{"buildTime":"'$$(date -u '+%Y-%m-%d %H:%M:%S UTC')'"}' > build-info.json

.PHONY: clean
clean:
	rm -rf build dist $(JS_FILES) build-info.json schemas/gschemas.compiled

# run build
.PHONY: run
dev: clean build start

# pack for distribution
.PHONY: pack
pack:
	rm build -rf
	rm *.zip -rf
	sh build.sh

.PHONY: install
install: build schemas
	rm -rf $(DEST)
	mkdir -p $(DEST)/schemas
	cp $(EXTENSION_FILES) $(DEST)/
	cp schemas/* $(DEST)/schemas/
	@echo "Installed to $(DEST)"
	@echo "On Wayland: log out and back in to activate"
	@echo "On X11: press Alt+F2, type 'r', press Enter"

.PHONY: uninstall
uninstall:
	rm -rf $(DEST)
	@echo "Uninstalled $(UUID)"

# create dist directory for CI artifacts
.PHONY: dist
dist: build schemas
	rm -rf dist
	mkdir -p dist/schemas
	cp $(EXTENSION_FILES) LICENSE dist/
	cp schemas/* dist/schemas/

# Testing and linting
.PHONY: test
test:
	npm test

.PHONY: lint
lint:
	npm run lint

.PHONY: lint-fix
lint-fix:
	npm run lint:fix

.PHONY: check
check:
	npm run check
	npm test
	@$(MAKE) verify-dist
	@echo "All checks passed!"

# Verify all required files end up in the distribution zip
.PHONY: verify-dist
verify-dist: pack
	@echo "######## Verifying distribution contents ########"
	@TMPDIR=$$(mktemp -d) && \
	unzip -q $(UUID).zip -d $$TMPDIR && \
	MISSING="" && \
	for f in $(JS_FILES) $(STATIC_FILES) schemas/org.gnome.shell.extensions.todozen.gschema.xml; do \
		if [ ! -f "$$TMPDIR/$$f" ]; then \
			MISSING="$$MISSING $$f"; \
		fi; \
	done && \
	rm -rf $$TMPDIR && \
	if [ -n "$$MISSING" ]; then \
		echo "ERROR: Missing files in zip:$$MISSING"; \
		exit 1; \
	fi && \
	echo "All required files present in distribution zip"
