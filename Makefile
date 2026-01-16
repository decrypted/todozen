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

clean_build:
	rm build *.zip *.js build-info.json -rf

# run build
.PHONY: run
dev: clean_build build start

# pack for distribution
.PHONY: pack
pack:
	rm build -rf
	rm *.zip -rf
	sh build.sh

# install to local gnome-shell extensions
UUID = todozen@irtesaam.github.io
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install
install: build schemas
	rm -rf $(DEST)
	mkdir -p $(DEST)/schemas
	cp extension.js manager.js history.js prefs.js utils.js metadata.json stylesheet.css prefs.ui build-info.json $(DEST)/
	cp schemas/* $(DEST)/schemas/
	@echo "Installed to $(DEST)"
	@echo "On Wayland: log out and back in to activate"
	@echo "On X11: press Alt+F2, type 'r', press Enter"

.PHONY: uninstall
uninstall:
	rm -rf $(DEST)
	@echo "Uninstalled $(UUID)"

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
	for f in extension.js manager.js history.js prefs.js utils.js metadata.json stylesheet.css prefs.ui schemas/org.gnome.shell.extensions.todozen.gschema.xml; do \
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