/**
 * Jersey Customizer — Theme App Extension script
 *
 * FRONT CUSTOMIZER (new):
 *  1. Step 1 — Club Badge / Logo
 *     - Upload or AI-generate a logo image
 *     - Drag to reposition on the front jersey canvas
 *     - Resize slider (15 – 75 % of canvas width)
 *  2. Step 2 — Front Sponsor
 *     - Upload or AI-generate a sponsor image
 *     - Auto-centered on the jersey front
 *     - Revealed after the logo is placed
 *
 * BACK CUSTOMIZER (existing):
 *  3. Apply the selected font to the live preview instantly
 *  4. Update name + number preview text as the customer types
 *  5. Validate both fields before Add to Cart
 *  6. Inject all customizations as Shopify line item properties
 */
(function () {
  "use strict";

  // Default font applied on page load (matches the first chip's --active state)
  var DEFAULT_FONT_CSS  = "'Jersey M54', Impact, sans-serif";
  var DEFAULT_FONT_NAME = "Jersey M54";

  // Default text color
  var DEFAULT_COLOR      = "#ffffff";
  var DEFAULT_COLOR_NAME = "White";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    var widget = document.querySelector("[data-jersey-customizer]");
    if (!widget) return;

    // ── Shared state for front customizer ──────────────────────
    var frontState = {
      logoSrc:        "",
      logoSource:     "",    // "Upload" | "AI Generated"
      logoPosX:       12,    // % from left
      logoPosY:       15,    // % from top
      logoSize:       30,    // % of canvas width (medium preset)
      logoSizeLabel:  'Medium (2.25\u2033 \u00d7 2.75\u2033)',  // stored as line-item property
      // Upload token: null = upload in progress, string = "pending-image:<id>",
      // false = upload failed (will fall back to base64 at submit time)
      logoToken:      null,
      logoUploading:  false,

      sponsorSrc:       "",
      sponsorSource:    "",  // "Upload" | "AI Generated"
      sponsorPosY:      45, // % from top — center chest area
      sponsorSize:      35, // % of canvas width — roughly 30-40% of jersey width
      sponsorToken:     null,
      sponsorUploading: false,
    };

    console.log("[Jersey Customizer] Front state defaults — sponsorSize:", frontState.sponsorSize, "sponsorPosY:", frontState.sponsorPosY);

    // ── Init front customizer ──────────────────────────────────
    initFrontCustomizer(widget, frontState);

    // ── Back customizer (existing) ─────────────────────────────
    var nameInput     = widget.querySelector("[data-jersey-name]");
    var numberInput   = widget.querySelector("[data-jersey-number]");
    var previewName   = widget.querySelector("[data-preview-name]");
    var previewNumber = widget.querySelector("[data-preview-number]");
    var nameError     = widget.querySelector("[data-name-error]");
    var numberError   = widget.querySelector("[data-number-error]");
    var fontButtons   = widget.querySelectorAll("[data-font-css]");
    var colorButtons  = widget.querySelectorAll("[data-color]");

    if (!nameInput || !numberInput) return;

    // Cart form lives outside the widget on most themes
    var form = document.querySelector(
      'form[action="/cart/add"], form[action*="/cart/add"]'
    );

    // Apply the default font and color immediately on load
    applyFont(previewName, previewNumber, DEFAULT_FONT_CSS, DEFAULT_FONT_NAME);
    applyColor(previewName, previewNumber, DEFAULT_COLOR);

    var selectedFontCss  = DEFAULT_FONT_CSS;
    var selectedFontName = DEFAULT_FONT_NAME;
    var selectedColor     = DEFAULT_COLOR;
    var selectedColorName = DEFAULT_COLOR_NAME;

    // Inject default properties immediately so they are present before any
    // AJAX add-to-cart handler snapshots the form (timing-race fix).
    if (form) {
      injectProperty(form, "Font",       selectedFontName);
      injectProperty(form, "Text Color", selectedColorName);
    }

    // ── Font selector ──────────────────────────────────────────
    fontButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        fontButtons.forEach(function (b) {
          b.classList.remove("jersey-customizer__font-btn--active");
          b.setAttribute("aria-selected", "false");
        });
        this.classList.add("jersey-customizer__font-btn--active");
        this.setAttribute("aria-selected", "true");
        selectedFontCss  = this.dataset.fontCss;
        selectedFontName = this.dataset.fontName;
        applyFont(previewName, previewNumber, selectedFontCss, selectedFontName);
        if (form) injectProperty(form, "Font", selectedFontName);
        this.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      });
    });

    // ── Color selector ─────────────────────────────────────────
    colorButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        colorButtons.forEach(function (b) {
          b.classList.remove("jersey-customizer__color-btn--active");
          b.setAttribute("aria-selected", "false");
        });
        this.classList.add("jersey-customizer__color-btn--active");
        this.setAttribute("aria-selected", "true");
        selectedColor     = this.dataset.color;
        selectedColorName = this.dataset.colorName;
        applyColor(previewName, previewNumber, selectedColor);
        if (form) injectProperty(form, "Text Color", selectedColorName);
      });
    });

    // ── Name input ─────────────────────────────────────────────
    nameInput.addEventListener("input", function () {
      this.value = this.value.replace(/[^a-zA-Z\s'\-]/g, "");
      var max = parseInt(this.dataset.maxLength || "20", 10);
      if (this.value.length > max) this.value = this.value.slice(0, max);
      updatePreview(previewName, this.value.toUpperCase(), "YOUR NAME");
      clearError(nameInput, nameError);
      if (form) injectProperty(form, "Player Name", this.value.trim());
    });

    // ── Number input ───────────────────────────────────────────
    numberInput.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "");
      var max = parseInt(this.dataset.max || "99", 10);
      var val = parseInt(this.value, 10);
      if (!isNaN(val) && val > max) this.value = String(max);
      if (!isNaN(val) && val < 0)   this.value = "0";
      updatePreview(previewNumber, this.value, "##");
      clearError(numberInput, numberError);
      if (form) injectProperty(form, "Jersey Number", this.value.trim());
    });

    // ── Intercept Add to Cart ──────────────────────────────────
    // capture: true — runs BEFORE bubble-phase AJAX handlers that snapshot
    // FormData early, ensuring our hidden inputs are present when the theme's
    // AJAX cart handler reads them.
    if (form) {
      form.addEventListener("submit", function (e) {
        // ── DEBUG: confirm the submit event actually fires ─────────────────
        console.log("[JC] submit event fired. frontState:", {
          logoSrc:      frontState.logoSrc   ? ("base64[" + frontState.logoSrc.length + "]")   : "",
          logoToken:    frontState.logoToken,
          sponsorSrc:   frontState.sponsorSrc ? ("base64[" + frontState.sponsorSrc.length + "]") : "",
          sponsorToken: frontState.sponsorToken,
        });

        var nameVal   = nameInput.value.trim();
        var numberVal = numberInput.value.trim();

        // Show validation hints for blank fields, but do NOT block submission —
        // a customer may legitimately want only front customization (logo/sponsor)
        // without a back name/number.
        if (!nameVal)   validateField(nameInput,   nameError,   "Player name is blank — leave empty to skip.");
        if (!numberVal) validateField(numberInput, numberError, "Jersey number is blank — leave empty to skip.");

        // Back customization properties — only inject if filled
        if (nameVal)   injectProperty(form, "Player Name",   nameVal);
        if (numberVal) injectProperty(form, "Jersey Number", numberVal);
        if (nameVal || numberVal) {
          injectProperty(form, "Font",       selectedFontName);
          injectProperty(form, "Text Color", selectedColorName);
        }

        // Front customization properties — re-inject at submit time as a safety
        // net in case applyLogoImage ran before the cart form existed in the DOM.
        // Prefer the uploaded token (short, never truncated); fall back to base64.
        if (frontState.logoSrc) {
          var logoValue = (typeof frontState.logoToken === "string")
            ? frontState.logoToken   // uploaded — safe to use as property value
            : frontState.logoSrc;    // fallback: base64 (may be truncated by Shopify)
          console.log("[JC] submit: injecting Logo Image —",
            typeof frontState.logoToken === "string" ? "TOKEN" : "BASE64 fallback",
            "— value length:", logoValue.length);
          injectProperty(form, "Logo Image",    logoValue);
          injectProperty(form, "Logo Source",   frontState.logoSource);
          injectProperty(form, "Logo Position",
            "x:" + Math.round(frontState.logoPosX) + "%,y:" + Math.round(frontState.logoPosY) + "%");
          injectProperty(form, "Logo Size",     frontState.logoSizeLabel);
        } else {
          console.log("[JC] submit: no logo — skipping Logo Image injection.");
        }

        if (frontState.sponsorSrc) {
          var sponsorValue = (typeof frontState.sponsorToken === "string")
            ? frontState.sponsorToken
            : frontState.sponsorSrc;
          console.log("[JC] submit: injecting Sponsor Image —",
            typeof frontState.sponsorToken === "string" ? "TOKEN" : "BASE64 fallback",
            "— value length:", sponsorValue.length);
          injectProperty(form, "Sponsor Image",    sponsorValue);
          injectProperty(form, "Sponsor Source",   frontState.sponsorSource);
          injectProperty(form, "Sponsor Position", "y:" + Math.round(frontState.sponsorPosY) + "%");
          injectProperty(form, "Sponsor Size",     frontState.sponsorSize + "%");
        } else {
          console.log("[JC] submit: no sponsor — skipping Sponsor Image injection.");
        }
      }, true);  // capture phase — runs before theme AJAX handlers
    }

    // ── Boot wizard ────────────────────────────────────────────
    // Fetch per-product feature flags from the App Proxy, then start the
    // wizard.  The fetch is fire-and-forget with a 3 s timeout so a slow
    // network never permanently blocks the widget — we fail open (all steps
    // enabled) rather than showing a broken experience.
    var productId = widget.dataset.productId || "";
    fetchProductFeatures(productId, function (features) {
      // If every feature is explicitly disabled, the widget has nothing to show.
      // Hide the entire container and bail out — no wizard is initialised.
      if (
        features.enableLogo    === false &&
        features.enableSponsor === false &&
        features.enableName    === false &&
        features.enableNumber  === false
      ) {
        widget.hidden = true;
        return;
      }

      initWizard(widget, frontState, nameInput, numberInput, form, features);
    });
  }

  /**
   * Fetches feature flags for a product from the App Proxy.
   * Always calls `callback` exactly once, even on error or timeout.
   *
   * @param {string}   productId  Numeric Shopify product ID
   * @param {Function} callback   Called with { enableLogo, enableSponsor,
   *                              enableName, enableNumber } (all true on error)
   */
  function fetchProductFeatures(productId, callback) {
    var called = false;
    function done(features) {
      if (called) return;
      called = true;
      callback(features || {});
    }

    // Timeout fallback — show all steps if the proxy is slow
    var timer = setTimeout(function () { done({}); }, 3000);

    if (!productId) {
      clearTimeout(timer);
      done({});
      return;
    }

    var url = "/apps/jersey-customizer/product-settings"
      + "?productId=" + encodeURIComponent(productId);

    fetch(url)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) { clearTimeout(timer); done(data); })
      .catch(function ()   { clearTimeout(timer); done({}); });
  }

  // ════════════════════════════════════════════════════════════
  //  FRONT CUSTOMIZER
  // ════════════════════════════════════════════════════════════

  // Physical print dimensions for the badge.
  // pct   — visual width as % of the preview canvas (jersey front image).
  // label — stored verbatim as the "Logo Size" Shopify line-item property.
  // hint  — short dimension string shown below the size buttons.
  var LOGO_SIZE_PRESETS = {
    small:  { pct: 22, label: 'Small (2.00\u2033 \u00d7 2.25\u2033)',  hint: '2.00\u2033 \u00d7 2.25\u2033'  },
    medium: { pct: 30, label: 'Medium (2.25\u2033 \u00d7 2.75\u2033)', hint: '2.25\u2033 \u00d7 2.75\u2033' },
    large:  { pct: 40, label: 'Large (2.50\u2033 \u00d7 3.25\u2033)',  hint: '2.50\u2033 \u00d7 3.25\u2033'  },
  };

  function initFrontCustomizer(widget, state) {
    var frontCanvas       = widget.querySelector("[data-front-canvas]");
    var logoWrapper       = widget.querySelector("[data-logo-wrapper]");
    var logoImg           = widget.querySelector("[data-logo-img]");
    var sponsorWrapper    = widget.querySelector("[data-sponsor-wrapper]");
    var sponsorImg        = widget.querySelector("[data-sponsor-img]");
    var logoStep           = widget.querySelector("[data-logo-step]");
    var sponsorStep        = widget.querySelector("[data-sponsor-step]");
    var logoResizeGroup    = widget.querySelector("[data-logo-resize]");
    var logoDragTip        = widget.querySelector("[data-logo-drag-tip]");
    var logoSizeBtns       = logoResizeGroup
                               ? logoResizeGroup.querySelectorAll("[data-logo-size]")
                               : [];
    var logoSizeHint       = logoResizeGroup
                               ? logoResizeGroup.querySelector("[data-logo-size-hint]")
                               : null;
    var sponsorSlider      = widget.querySelector("[data-sponsor-slider]");
    var sponsorSizeLabel   = widget.querySelector("[data-sponsor-size-label]");
    var sponsorResizeGroup = widget.querySelector("[data-sponsor-resize]");
    var sponsorDragTip     = widget.querySelector("[data-sponsor-drag-tip]");

    if (!frontCanvas) return;

    // ── Tab switching ───────────────────────────────────────────
    initTabSwitcher(logoStep);
    initTabSwitcher(sponsorStep);

    // ── Logo drag (free XY) ────────────────────────────────────
    if (logoWrapper) {
      initLogoDrag(frontCanvas, logoWrapper, state);
    }

    // ── Sponsor drag (vertical only, stays horizontally centred) ─
    if (sponsorWrapper) {
      initSponsorDrag(frontCanvas, sponsorWrapper, state);
    }

    // ── Logo size preset buttons ────────────────────────────────
    logoSizeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key    = this.dataset.logoSize;
        var preset = LOGO_SIZE_PRESETS[key];
        if (!preset) return;

        // Persist selection in state
        state.logoSize      = preset.pct;
        state.logoSizeLabel = preset.label;

        // Resize the overlay if a logo is already placed
        if (state.logoSrc) setElementWidth(logoWrapper, preset.pct);

        // Update button active state
        logoSizeBtns.forEach(function (b) {
          var active = (b === btn);
          b.classList.toggle("jcw__size-btn--active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });

        // Update hint text
        if (logoSizeHint) logoSizeHint.textContent = preset.hint;

        // Re-inject into cart form so the property stays current
        var cartForm = document.querySelector('form[action="/cart/add"], form[action*="/cart/add"]');
        if (cartForm && state.logoSrc) {
          injectProperty(cartForm, "Logo Size", preset.label);
        }
      });
    });

    // ── Sponsor size slider ─────────────────────────────────────
    if (sponsorSlider) {
      requestAnimationFrame(function () { updateSliderTrack(sponsorSlider); });
      sponsorSlider.addEventListener("input", function () {
        var pct = parseFloat(this.value);
        state.sponsorSize = pct;
        setElementWidth(sponsorWrapper, pct);
        if (sponsorSizeLabel) sponsorSizeLabel.textContent = getSizeLabel(pct);
        updateSliderTrack(this);
      });
    }

    // ── Logo upload ─────────────────────────────────────────────
    var logoFileInput  = widget.querySelector("[data-logo-file]");
    var logoFileNameEl = widget.querySelector("[data-logo-file-name]");
    if (logoFileInput) {
      logoFileInput.addEventListener("change", function () {
        var file = this.files && this.files[0];
        if (!file) return;
        if (logoFileNameEl) logoFileNameEl.textContent = file.name;
        compressAndLoadImage(file, function (dataUrl) {
          applyLogoImage(logoImg, logoWrapper, dataUrl, state, logoResizeGroup, logoDragTip);
          state.logoSource = "Upload";
          revealSponsorStep(sponsorStep);
        });
      });
    }

    // ── Logo AI generate ────────────────────────────────────────
    var logoPromptInput = widget.querySelector("[data-logo-prompt]");
    var logoGenerateBtn = widget.querySelector("[data-logo-generate]");
    var logoAiStatus    = widget.querySelector("[data-logo-ai-status]");
    if (logoGenerateBtn) {
      logoGenerateBtn.addEventListener("click", function () {
        var prompt = (logoPromptInput && logoPromptInput.value.trim()) || "";
        if (!prompt) {
          showAiStatus(logoAiStatus, "error", "Please describe the badge you want to generate.");
          return;
        }
        setGenerateBtnLoading(logoGenerateBtn, true);
        generateAiImage(widget, prompt, "logo", logoAiStatus, function (dataUrl) {
          setGenerateBtnLoading(logoGenerateBtn, false);
          logoGenerateBtn.textContent = "Regenerate";
          normalizeSvgDataUrl(dataUrl, function (normalizedUrl) {
            applyLogoImage(logoImg, logoWrapper, normalizedUrl, state, logoResizeGroup, logoDragTip);
            state.logoSource = "AI Generated";
            revealSponsorStep(sponsorStep);
          });
        }, function () {
          setGenerateBtnLoading(logoGenerateBtn, false);
        });
      });
    }

    // ── Sponsor upload ──────────────────────────────────────────
    var sponsorFileInput  = widget.querySelector("[data-sponsor-file]");
    var sponsorFileNameEl = widget.querySelector("[data-sponsor-file-name]");
    if (sponsorFileInput) {
      sponsorFileInput.addEventListener("change", function () {
        var file = this.files && this.files[0];
        if (!file) return;
        if (sponsorFileNameEl) sponsorFileNameEl.textContent = file.name;
        compressAndLoadImage(file, function (dataUrl) {
          applySponsorImage(sponsorImg, sponsorWrapper, dataUrl, state,
                            sponsorResizeGroup, sponsorDragTip, sponsorSlider, sponsorSizeLabel);
          state.sponsorSource = "Upload";
        });
      });
    }

    // ── Sponsor AI generate ─────────────────────────────────────
    var sponsorPromptInput = widget.querySelector("[data-sponsor-prompt]");
    var sponsorGenerateBtn = widget.querySelector("[data-sponsor-generate]");
    var sponsorAiStatus    = widget.querySelector("[data-sponsor-ai-status]");
    if (sponsorGenerateBtn) {
      sponsorGenerateBtn.addEventListener("click", function () {
        var prompt = (sponsorPromptInput && sponsorPromptInput.value.trim()) || "";
        if (!prompt) {
          showAiStatus(sponsorAiStatus, "error", "Please describe the sponsor logo you want to generate.");
          return;
        }
        setGenerateBtnLoading(sponsorGenerateBtn, true);
        generateAiImage(widget, prompt, "sponsor", sponsorAiStatus, function (dataUrl) {
          setGenerateBtnLoading(sponsorGenerateBtn, false);
          sponsorGenerateBtn.textContent = "Regenerate";
          normalizeSvgDataUrl(dataUrl, function (normalizedUrl) {
            applySponsorImage(sponsorImg, sponsorWrapper, normalizedUrl, state,
                              sponsorResizeGroup, sponsorDragTip, sponsorSlider, sponsorSizeLabel);
            state.sponsorSource = "AI Generated";
          });
        }, function () {
          setGenerateBtnLoading(sponsorGenerateBtn, false);
        });
      });
    }
  }

  /**
   * Apply a loaded image to the logo overlay and reveal the controls.
   *
   * Injects hidden form inputs IMMEDIATELY (base64 fallback) so that
   * AJAX-cart themes that snapshot FormData on button click always see the
   * logo properties — even if the App Proxy upload hasn't finished yet.
   * When the upload completes the hidden input is updated to the short token.
   */
  function applyLogoImage(imgEl, wrapper, dataUrl, state, resizeGroup, dragTip) {
    state.logoSrc      = dataUrl;
    state.logoToken    = null;   // reset — new upload in progress
    state.logoUploading = true;

    imgEl.src = dataUrl;
    wrapper.hidden = false;
    setElementWidth(wrapper, state.logoSize);
    wrapper.style.left = state.logoPosX + "%";
    wrapper.style.top  = state.logoPosY + "%";

    // Reveal the size picker and drag tip (no slider to initialise)
    if (resizeGroup) resizeGroup.hidden = false;
    if (dragTip)     dragTip.hidden     = false;

    updateSubmitLock(state);

    // ── Eagerly inject base64 into the form right now ──────────────────────
    // Many Shopify themes use click-based AJAX cart and never fire a form
    // submit event, so the submit handler's logo injection block would never
    // run.  Writing the hidden inputs here ensures they are present in the
    // form before ANY add-to-cart path (click, submit, or fetch) reads them.
    var cartForm = document.querySelector('form[action="/cart/add"], form[action*="/cart/add"]');
    if (cartForm) {
      console.log("[JC] applyLogoImage — injecting base64 fallback into form now. dataUrl length:", dataUrl.length);
      injectProperty(cartForm, "Logo Image",    dataUrl);  // base64 — will be overwritten by token
      injectProperty(cartForm, "Logo Source",   state.logoSource || "Upload");
      injectProperty(cartForm, "Logo Position",
        "x:" + Math.round(state.logoPosX) + "%,y:" + Math.round(state.logoPosY) + "%");
      injectProperty(cartForm, "Logo Size",     state.logoSizeLabel);
    } else {
      console.warn("[JC] applyLogoImage — cart form NOT found; properties will be injected on submit only.");
    }

    uploadImage(dataUrl, "logo", function (token) {
      console.log("[JC] Logo upload SUCCESS — token:", token);
      state.logoToken     = token;
      state.logoUploading = false;
      // Upgrade the hidden input from base64 → short token immediately
      if (cartForm) {
        injectProperty(cartForm, "Logo Image", token);
        console.log("[JC] Logo form property updated to token.");
      }
      updateSubmitLock(state);
    }, function (err) {
      console.warn("[JC] Logo upload FAILED — base64 fallback remains in form:", err);
      state.logoToken     = false;  // mark failed; base64 is already in the form
      state.logoUploading = false;
      updateSubmitLock(state);
    });
  }

  /**
   * Apply a loaded image to the sponsor overlay and reveal the controls.
   * The sponsor is always horizontally centred; only `top` changes on drag.
   * Same eager-injection strategy as applyLogoImage — see comment above.
   */
  function applySponsorImage(imgEl, wrapper, dataUrl, state, resizeGroup, dragTip, slider, sizeLabel) {
    state.sponsorSrc      = dataUrl;
    state.sponsorToken    = null;
    state.sponsorUploading = true;

    imgEl.src = dataUrl;
    wrapper.hidden = false;
    setElementWidth(wrapper, state.sponsorSize);
    wrapper.style.top = state.sponsorPosY + "%";
    revealAndInitSlider(resizeGroup, dragTip, slider, state.sponsorSize, sizeLabel);
    updateSubmitLock(state);

    // ── Eagerly inject base64 into the form right now ──────────────────────
    var cartForm = document.querySelector('form[action="/cart/add"], form[action*="/cart/add"]');
    if (cartForm) {
      console.log("[JC] applySponsorImage — injecting base64 fallback into form now. dataUrl length:", dataUrl.length);
      injectProperty(cartForm, "Sponsor Image",    dataUrl);
      injectProperty(cartForm, "Sponsor Source",   state.sponsorSource || "Upload");
      injectProperty(cartForm, "Sponsor Position", "y:" + Math.round(state.sponsorPosY) + "%");
      injectProperty(cartForm, "Sponsor Size",     state.sponsorSize + "%");
    } else {
      console.warn("[JC] applySponsorImage — cart form NOT found; properties will be injected on submit only.");
    }

    uploadImage(dataUrl, "sponsor", function (token) {
      console.log("[JC] Sponsor upload SUCCESS — token:", token);
      state.sponsorToken     = token;
      state.sponsorUploading = false;
      if (cartForm) {
        injectProperty(cartForm, "Sponsor Image", token);
        console.log("[JC] Sponsor form property updated to token.");
      }
      updateSubmitLock(state);
    }, function (err) {
      console.warn("[JC] Sponsor upload FAILED — base64 fallback remains in form:", err);
      state.sponsorToken     = false;
      state.sponsorUploading = false;
      updateSubmitLock(state);
    });
  }

  /**
   * Reveal the resize group + drag tip, then set the slider's value and fill
   * track in the NEXT animation frame.
   *
   * Why requestAnimationFrame?
   * Chromium (and some WebKit) browsers reset <input type="range"> back to its
   * minimum when the element transitions from display:none → visible during the
   * same synchronous task. The reset happens between our `hidden = false` and
   * our `slider.value = …` if both run in the same task, so the rendered thumb
   * ends up at the far left (min) and getSizeLabel returns "XS".
   * Scheduling the value-set in the next frame guarantees it runs after the
   * browser has committed the layout change, so the explicit value wins.
   */
  function revealAndInitSlider(resizeGroup, dragTip, slider, value, sizeLabel) {
    if (resizeGroup) resizeGroup.hidden = false;
    if (dragTip)     dragTip.hidden     = false;

    requestAnimationFrame(function () {
      if (slider) {
        slider.value = value;
        updateSliderTrack(slider);
      }
      if (sizeLabel) sizeLabel.textContent = getSizeLabel(value);
    });
  }

  // ════════════════════════════════════════════════════════════
  //  TAB SWITCHER
  // ════════════════════════════════════════════════════════════

  /**
   * Wire up the method tabs (Upload / AI) within a step element.
   * Tabs have [data-tab="panel-id"], panels have [data-panel="panel-id"].
   */
  function initTabSwitcher(stepEl) {
    if (!stepEl) return;
    var tabs = stepEl.querySelectorAll("[data-tab]");
    if (!tabs.length) return;

    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var targetId = this.dataset.tab;
        tabs.forEach(function (b) {
          b.classList.remove("jersey-customizer__method-tab--active");
          b.setAttribute("aria-selected", "false");
        });
        this.classList.add("jersey-customizer__method-tab--active");
        this.setAttribute("aria-selected", "true");

        stepEl.querySelectorAll("[data-panel]").forEach(function (panel) {
          panel.hidden = (panel.dataset.panel !== targetId);
        });
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  //  LOGO DRAG
  // ════════════════════════════════════════════════════════════

  function initLogoDrag(canvas, wrapper, state) {
    var dragging   = false;
    var startCX, startCY, startLeft, startTop;

    wrapper.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      dragging   = true;
      startCX    = e.clientX;
      startCY    = e.clientY;
      startLeft  = parseFloat(wrapper.style.left) || state.logoPosX;
      startTop   = parseFloat(wrapper.style.top)  || state.logoPosY;
      this.setPointerCapture(e.pointerId);
      this.style.cursor = "grabbing";
    });

    wrapper.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var rect   = canvas.getBoundingClientRect();
      var dx     = (e.clientX - startCX) / rect.width  * 100;
      var dy     = (e.clientY - startCY) / rect.height * 100;
      var newLeft = clamp(startLeft + dx, 0, 80);
      var newTop  = clamp(startTop  + dy, 0, 82);
      wrapper.style.left = newLeft + "%";
      wrapper.style.top  = newTop  + "%";
      state.logoPosX = newLeft;
      state.logoPosY = newTop;
    });

    wrapper.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      this.releasePointerCapture(e.pointerId);
      this.style.cursor = "grab";
    });

    wrapper.addEventListener("lostpointercapture", function () {
      dragging = false;
      this.style.cursor = "grab";
    });
  }

  // ════════════════════════════════════════════════════════════
  //  SPONSOR DRAG  (vertical only — stays horizontally centred)
  // ════════════════════════════════════════════════════════════

  /**
   * The sponsor is pinned at left:50% + translateX(-50%) so it is always
   * horizontally centred on the jersey, matching real-world jersey sponsor
   * placement. Only `top` is changed while dragging.
   */
  function initSponsorDrag(canvas, wrapper, state) {
    var dragging = false;
    var startCY, startTop;

    wrapper.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      dragging = true;
      startCY  = e.clientY;
      startTop = parseFloat(wrapper.style.top) || state.sponsorPosY;
      this.setPointerCapture(e.pointerId);
      this.style.cursor = "grabbing";
    });

    wrapper.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var rect   = canvas.getBoundingClientRect();
      var dy     = (e.clientY - startCY) / rect.height * 100;
      var newTop = clamp(startTop + dy, 22, 76);
      wrapper.style.top = newTop + "%";
      state.sponsorPosY = newTop;
    });

    wrapper.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      this.releasePointerCapture(e.pointerId);
      this.style.cursor = "grab";
    });

    wrapper.addEventListener("lostpointercapture", function () {
      dragging = false;
      this.style.cursor = "grab";
    });
  }

  // ════════════════════════════════════════════════════════════
  //  IMAGE UPLOAD  (persist before cart submit)
  // ════════════════════════════════════════════════════════════

  /**
   * POST the base64 image to the upload proxy endpoint and return a short
   * "pending-image:<cuid>" token via onSuccess.
   *
   * The token is stored as the Shopify line-item property value instead of
   * the raw base64 (40–135 KB), which Shopify silently truncates.
   * The orders/create webhook resolves the token back to the full image.
   *
   * @param {string}   dataUrl   data:image/png;base64,… from canvas
   * @param {string}   type      "logo" | "sponsor"
   * @param {Function} onSuccess Called with the token string on success
   * @param {Function} onError   Called with an error message string on failure
   */
  function uploadImage(dataUrl, type, onSuccess, onError) {
    console.log("[JC] uploadImage — POSTing to /apps/jersey-customizer/upload-image, type:", type,
      "dataUrl length:", dataUrl.length);
    fetch("/apps/jersey-customizer/upload-image", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ data: dataUrl, type: type }),
    })
      .then(function (res) {
        console.log("[JC] uploadImage — response status:", res.status, res.url);
        return res.text().then(function (text) {
          console.log("[JC] uploadImage — raw response body (first 200 chars):", text.slice(0, 200));
          var json;
          try { json = JSON.parse(text); } catch (_) { throw new Error("Non-JSON response (status " + res.status + "): " + text.slice(0, 100)); }
          if (!res.ok) throw new Error(json.error || ("Upload error " + res.status));
          return json;
        });
      })
      .then(function (json) {
        if (json && typeof json.token === "string") {
          onSuccess(json.token);
        } else {
          onError(json.error || "No token returned");
        }
      })
      .catch(function (err) {
        console.error("[JC] uploadImage — fetch error:", err && err.message);
        onError((err && err.message) || "Network error");
      });
  }

  /**
   * Disable the cart submit button while any image upload is in progress.
   * Re-enables it (and clears the uploading label) once all uploads settle.
   *
   * This prevents the customer from submitting with a base64 fallback value
   * when a completed upload token is just milliseconds away.
   */
  function updateSubmitLock(state) {
    var uploading = state.logoUploading || state.sponsorUploading;
    var form = document.querySelector('form[action="/cart/add"], form[action*="/cart/add"]');
    if (!form) return;

    var btn = form.querySelector('[type="submit"]');
    if (!btn) return;

    if (uploading) {
      btn.disabled = true;
      if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
      btn.textContent = "Saving images\u2026";
    } else {
      btn.disabled = false;
      if (btn.dataset.origLabel) {
        btn.textContent = btn.dataset.origLabel;
        delete btn.dataset.origLabel;
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  //  AI IMAGE GENERATION
  // ════════════════════════════════════════════════════════════

  /**
   * POST to the Shopify App Proxy endpoint for AI image generation.
   * The request goes to the Shopify store domain (/apps/jersey-customizer/…),
   * which Shopify proxies server-to-server to the app — no tunnel URL needed
   * in the browser, no CORS issues, stable regardless of tunnel state.
   *
   * Request body:  { prompt: string, type: "logo" | "sponsor" }
   * Response body: { imageUrl: string } | { error: string }
   */
  function generateAiImage(widget, prompt, type, statusEl, onSuccess, onError) {
    var endpoint = "/apps/jersey-customizer/generate-image";

    showAiStatus(statusEl, "loading", "Generating\u2026 this usually takes 5\u201315 seconds.");

    fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ prompt: prompt, type: type })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || ("Server error " + res.status));
          return data;
        });
      })
      .then(function (data) {
        if (data && data.imageUrl) {
          showAiStatus(statusEl, "success", "Done! Drag to reposition, use the slider to resize.");
          onSuccess(data.imageUrl);
        } else {
          throw new Error(data.error || "No image returned");
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Generation failed";
        showAiStatus(statusEl, "error", msg + " — try a different description or upload your own image.");
        if (onError) onError();
      });
  }

  /**
   * Toggle loading state on a Generate/Regenerate button.
   * Saves the button's current label so it can be restored on error.
   */
  function setGenerateBtnLoading(btn, isLoading) {
    if (isLoading) {
      btn.dataset.prevLabel = btn.textContent;
      btn.textContent = "Generating\u2026";
      btn.classList.add("jersey-customizer__generate-btn--loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("jersey-customizer__generate-btn--loading");
      btn.disabled = false;
      // On error, restore previous label; on success the caller sets "Regenerate"
      if (btn.textContent === "Generating\u2026") {
        btn.textContent = btn.dataset.prevLabel || "Generate";
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  //  UTILITIES
  // ════════════════════════════════════════════════════════════

  /**
   * Render an SVG data URL to a PNG via canvas.
   *
   * When an SVG is used as <img src>, some browsers cannot compute intrinsic
   * dimensions if the SVG lacks explicit pixel width/height attributes (e.g.
   * uses width="100%" or omits them entirely).  The img collapses to 0 px
   * height, making the overlay invisible even though the src is set.
   *
   * Drawing to an off-screen canvas then exporting as PNG guarantees a raster
   * image with known pixel dimensions that renders reliably at any size.
   * Falls back to the original data URL if the Image fails to load or if the
   * browser cannot determine natural dimensions.
   */
  function normalizeSvgDataUrl(dataUrl, callback) {
    if (dataUrl.indexOf("data:image/svg+xml") !== 0) {
      callback(dataUrl);
      return;
    }
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth  || 400;
      var h = img.naturalHeight || 400;
      try {
        var cvs = document.createElement("canvas");
        cvs.width  = w;
        cvs.height = h;
        var ctx = cvs.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        callback(cvs.toDataURL("image/png", 0.92));
      } catch (e) {
        // Tainted canvas or unsupported — fall back to original
        callback(dataUrl);
      }
    };
    img.onerror = function () {
      callback(dataUrl);
    };
    img.src = dataUrl;
  }

  /**
   * Compress and resize an uploaded File to max 360 px wide,
   * returning a base64 PNG data URL via callback.
   */
  function compressAndLoadImage(file, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var maxW   = 360;
        var scale  = Math.min(1, maxW / img.naturalWidth);
        var w      = Math.round(img.naturalWidth  * scale);
        var h      = Math.round(img.naturalHeight * scale);
        var cvs    = document.createElement("canvas");
        cvs.width  = w;
        cvs.height = h;
        var ctx = cvs.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        callback(cvs.toDataURL("image/png", 0.88));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /** Set an overlay element's width as a percentage of its parent */
  function setElementWidth(wrapper, pct) {
    if (wrapper) wrapper.style.width = pct + "%";
  }

  /** Map slider value (15–75) to a human-readable label */
  function getSizeLabel(pct) {
    if (pct <= 22) return "XS";
    if (pct <= 35) return "Small";
    if (pct <= 50) return "Medium";
    if (pct <= 63) return "Large";
    return "XL";
  }

  /**
   * Paint the slider's filled track by setting style.background directly.
   *
   * Using style.background (inline) rather than a CSS custom property avoids
   * two failure modes seen in production Shopify themes:
   *   1. Theme CSS resets wipe inline custom properties on form elements.
   *   2. Browsers discard custom-property changes that happen in the same task
   *      as an un-hide operation (the property is painted with the stale value).
   * A direct inline background gradient has the highest possible specificity and
   * is always applied after the repaint that reveals the slider.
   */
  function updateSliderTrack(slider) {
    var min = parseFloat(slider.min) || 0;
    var max = parseFloat(slider.max) || 100;
    var val = parseFloat(slider.value);
    if (isNaN(val)) val = min;
    val = Math.max(min, Math.min(max, val));
    var pct = ((val - min) / (max - min) * 100).toFixed(2);
    var fill  = "#e8405a";
    var track = "rgba(0,0,0,0.12)";
    slider.style.background =
      "linear-gradient(to right," +
      fill  + " 0%," +
      fill  + " " + pct + "%," +
      track + " " + pct + "%," +
      track + " 100%)";
  }

  /**
   * revealSponsorStep is a no-op in the wizard UI.
   * Step navigation is handled exclusively by initWizard.
   * The function is kept so existing call sites (upload / AI callbacks) don't break.
   */
  function revealSponsorStep() {
    // no-op — wizard controls step flow
  }

  /** Update the AI status area with a typed message */
  function showAiStatus(el, type, message) {
    if (!el) return;
    el.textContent = message;
    el.className   = "jersey-customizer__ai-status jersey-customizer__ai-status--" + type;
  }

  // ════════════════════════════════════════════════════════════
  //  BACK-JERSEY HELPERS  (unchanged from original)
  // ════════════════════════════════════════════════════════════

  function applyFont(nameEl, numberEl, fontCss, fontName) {
    if (nameEl)   nameEl.style.fontFamily   = fontCss;
    if (numberEl) numberEl.style.fontFamily = fontCss;
    // Freshman's digits sit too close together; Amoresa Aged spacing can be
    // tuned here if needed after testing the live preview.
    var numLetterSpacing = fontName === "Freshman" ? "0.08em" : "";
    if (numberEl) numberEl.style.letterSpacing = numLetterSpacing;
    // Re-fit name text — different fonts have very different character widths
    // (script fonts like Amoresa Aged are much wider than condensed display fonts).
    fitPreviewText(nameEl);
  }

  /**
   * Scales the name preview element horizontally so text always fits on one
   * line within 90 % of its container.
   *
   * Why scaleX (not font-size reduction)?
   *   Jersey back names are always stretched to fill the label width in the
   *   actual print file (stretchX=true in opentype.js). scaleX in the preview
   *   mirrors that behaviour, keeping the visual faithful to the final output.
   *   It also avoids fighting with the CSS clamp() font-size.
   *
   * Why requestAnimationFrame?
   *   The browser needs a paint pass after a font-family or textContent change
   *   before scrollWidth reflects the new glyph metrics.
   */
  function fitPreviewText(el) {
    if (!el) return;
    // Clear any previous scale so scrollWidth reflects natural text width.
    el.style.transform = "";
    el.style.transformOrigin = "";
    requestAnimationFrame(function () {
      // scrollWidth = natural text width (may exceed offsetWidth when
      // white-space:nowrap causes overflow beyond max-width:90%).
      if (el.scrollWidth <= el.offsetWidth) return; // already fits — nothing to do
      var scale = el.offsetWidth / el.scrollWidth;
      scale = Math.max(scale, 0.4); // never squish below 40 %
      el.style.transform = "scaleX(" + scale + ")";
      el.style.transformOrigin = "center center";
    });
  }

  function applyColor(nameEl, numberEl, color) {
    if (nameEl)   { nameEl.style.color   = color; nameEl.style.textShadow   = "none"; nameEl.style.webkitTextStroke   = "0"; }
    if (numberEl) { numberEl.style.color = color; numberEl.style.textShadow = "none"; numberEl.style.webkitTextStroke = "0"; }
  }

  function updatePreview(el, value, placeholder) {
    if (!el) return;
    var cls = el.dataset.placeholderClass || "jersey-customizer__preview-name--placeholder";
    if (value) {
      el.textContent = value;
      el.classList.remove(cls);
    } else {
      el.textContent = placeholder;
      el.classList.add(cls);
    }
    fitPreviewText(el);
  }

  function validateField(input, errorEl, message) {
    if (!input.value.trim()) {
      input.classList.add("jersey-customizer__input--error");
      if (errorEl) errorEl.textContent = message;
      return false;
    }
    return true;
  }

  function clearError(input, errorEl) {
    input.classList.remove("jersey-customizer__input--error");
    if (errorEl) errorEl.textContent = "";
  }

  function injectProperty(form, key, value) {
    var existing = form.querySelector('[data-jersey-prop="' + key + '"]');
    if (existing) { existing.value = value; return; }
    var input   = document.createElement("input");
    input.type  = "hidden";
    input.name  = "properties[" + key + "]";
    input.value = value;
    input.setAttribute("data-jersey-prop", key);
    form.appendChild(input);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // ════════════════════════════════════════════════════════════
  //  WIZARD
  // ════════════════════════════════════════════════════════════

  /**
   * Drive the step-by-step wizard UI.
   *
   * Steps: intro → logo → sponsor → name → number → summary → review
   *
   * Canvas visibility per step:
   *   intro / logo / sponsor  → front only
   *   name / number           → back only
   *   summary                 → both hidden
   *   review                  → both side-by-side
   *
   * Progress dots + header are shown on steps logo–number.
   */
  function initWizard(widget, frontState, nameInput, numberInput, form, features) {
    // ── Feature flags (fail open — default true if not provided) ────────────
    features = features || {};
    var feat = {
      logo:    features.enableLogo    !== false,
      sponsor: features.enableSponsor !== false,
      name:    features.enableName    !== false,
      number:  features.enableNumber  !== false,
    };

    // Filter the step lists to only include enabled feature steps.
    // nextStep / prevStep operate on these filtered arrays, so disabled
    // steps are automatically skipped during navigation.
    var ALL_STEPS     = ["intro", "logo", "sponsor", "name", "number", "summary", "review"];
    var ALL_DOT_STEPS = ["logo", "sponsor", "name", "number"];

    var STEPS     = ALL_STEPS.filter(function (s) {
      return feat[s] !== false; // non-feature steps (intro/summary/review) always included
    });
    var DOT_STEPS = ALL_DOT_STEPS.filter(function (s) { return feat[s]; });

    // Hide progress dots for disabled features
    ALL_DOT_STEPS.forEach(function (s) {
      if (!feat[s]) {
        var dotEl = widget.querySelector("[data-dot='" + s + "']");
        if (dotEl) dotEl.hidden = true;
      }
    });

    // Hide summary rows for disabled features
    ALL_DOT_STEPS.forEach(function (s) {
      if (!feat[s]) {
        var rowEl = widget.querySelector("[data-summary-row='" + s + "']");
        if (rowEl) rowEl.hidden = true;
      }
    });

    var currentStep = "intro";

    // ── DOM refs ───────────────────────────────────────────────
    var header       = widget.querySelector("[data-wiz-header]");
    var canvasesEl   = widget.querySelector("[data-wiz-canvases]");
    var canvasFront  = widget.querySelector("[data-canvas-front]");
    var canvasBack   = widget.querySelector("[data-canvas-back]");
    var counter      = widget.querySelector("[data-wiz-counter]");
    var agreeCheck   = widget.querySelector("[data-wiz-agree]");
    var submitBtn    = widget.querySelector("[data-wiz-submit]");
    var uploadStatus = widget.querySelector("[data-wiz-upload-status]");

    var stepPanels = {};
    STEPS.forEach(function (s) {
      stepPanels[s] = widget.querySelector("[data-step='" + s + "']");
    });

    var dots = {};
    DOT_STEPS.forEach(function (s) {
      dots[s] = widget.querySelector("[data-dot='" + s + "']");
    });

    // ── goToStep ───────────────────────────────────────────────

    function goToStep(step) {
      // Hide old step
      if (stepPanels[currentStep]) stepPanels[currentStep].hidden = true;

      currentStep = step;

      // Show new step
      var panel = stepPanels[step];
      if (panel) panel.hidden = false;

      // ── Canvas visibility ────────────────────────────────────
      if (step === "review") {
        canvasesEl.classList.add("jcw__canvases--review");
        if (canvasFront) canvasFront.hidden = false;
        if (canvasBack)  canvasBack.hidden  = false;
      } else {
        canvasesEl.classList.remove("jcw__canvases--review");
        var showFront = (step === "intro" || step === "logo" || step === "sponsor");
        var showBack  = (step === "name"  || step === "number");
        // summary → both hidden
        if (canvasFront) canvasFront.hidden = !showFront;
        if (canvasBack)  canvasBack.hidden  = !showBack;
      }

      // ── Header + dots ────────────────────────────────────────
      var dotIdx = DOT_STEPS.indexOf(step);  // -1 on non-dot steps
      var showHeader = dotIdx !== -1;
      if (header) header.hidden = !showHeader;

      DOT_STEPS.forEach(function (s, i) {
        var dot = dots[s];
        if (!dot) return;
        dot.classList.remove("jcw__dot--active", "jcw__dot--done");
        if (i === dotIdx)       dot.classList.add("jcw__dot--active");
        else if (i < dotIdx)   dot.classList.add("jcw__dot--done");
      });

      if (counter) {
        counter.textContent = showHeader ? (dotIdx + 1) + " / " + DOT_STEPS.length : "";
      }

      // ── Per-step hooks ───────────────────────────────────────
      if (step === "summary") updateSummary();
      if (step === "review")  updateReview();

      // Scroll widget into view for mobile
      requestAnimationFrame(function () {
        widget.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }

    function nextStep(current) {
      var idx = STEPS.indexOf(current);
      return idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : current;
    }

    function prevStep(current) {
      var idx = STEPS.indexOf(current);
      return idx > 0 ? STEPS[idx - 1] : current;
    }

    // ── Wire navigation ────────────────────────────────────────

    // Start button (intro → first enabled content step)
    var startBtn = widget.querySelector("[data-wiz-start]");
    if (startBtn) {
      startBtn.addEventListener("click", function () { goToStep(nextStep("intro")); });
    }

    // Next buttons — each lives inside its step panel
    widget.querySelectorAll("[data-wiz-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.closest("[data-step]");
        if (panel) goToStep(nextStep(panel.dataset.step));
      });
    });

    // Skip buttons
    widget.querySelectorAll("[data-wiz-skip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.closest("[data-step]");
        if (panel) goToStep(nextStep(panel.dataset.step));
      });
    });

    // Back buttons — one per step (inside jcw__step-nav), each derives its
    // target from its own [data-step] ancestor so no central state is needed.
    widget.querySelectorAll("[data-wiz-back]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.closest("[data-step]");
        var step  = panel ? panel.dataset.step : currentStep;
        goToStep(prevStep(step));
      });
    });

    // "Edit customizations" buttons (summary + review) — restart from intro
    widget.querySelectorAll("[data-wiz-restart]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToStep("intro");
      });
    });

    // "Review & Add to Cart" button (on summary step)
    var toReviewBtn = widget.querySelector("[data-wiz-to-review]");
    if (toReviewBtn) {
      toReviewBtn.addEventListener("click", function () { goToStep("review"); });
    }

    // ── Agree checkbox → enable submit ─────────────────────────

    if (agreeCheck && submitBtn) {
      agreeCheck.addEventListener("change", function () {
        submitBtn.disabled = !this.checked;
      });
    }

    // ── Wizard "Add to Cart" button ────────────────────────────

    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        // Block while images are still uploading
        if (frontState.logoUploading || frontState.sponsorUploading) {
          if (uploadStatus) uploadStatus.hidden = false;
          return;
        }
        if (uploadStatus) uploadStatus.hidden = true;

        // Trigger the theme's actual Add-to-Cart submit button so that:
        //   - the theme's own AJAX cart handler fires, AND
        //   - our capture-phase form submit listener fires to re-inject all props
        var themeBtn = form ? form.querySelector('[type="submit"]') : null;
        if (themeBtn) {
          themeBtn.click();
        } else if (form) {
          // Fallback: request submit (triggers event listeners unlike form.submit())
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            form.submit();
          }
        }
      });
    }

    // ── Summary updater ────────────────────────────────────────

    function updateSummary() {
      function setRow(key, icon, val) {
        var iconEl = widget.querySelector("[data-summary-icon='" + key + "']");
        var valEl  = widget.querySelector("[data-summary-val='"  + key + "']");
        if (iconEl) iconEl.textContent = icon;
        if (valEl)  valEl.textContent  = val;
      }
      setRow("logo",    frontState.logoSrc      ? "✓" : "—", frontState.logoSrc      ? "Added" : "None");
      setRow("sponsor", frontState.sponsorSrc   ? "✓" : "—", frontState.sponsorSrc   ? "Added" : "None");
      var nameVal   = nameInput   ? nameInput.value.trim()   : "";
      var numberVal = numberInput ? numberInput.value.trim() : "";
      setRow("name",   nameVal   ? "✓" : "—", nameVal   || "None");
      setRow("number", numberVal ? "✓" : "—", numberVal || "None");
    }

    // ── Review list updater ────────────────────────────────────

    function updateReview() {
      var list = widget.querySelector("[data-review-list]");
      if (!list) return;
      list.innerHTML = "";

      var nameVal   = nameInput   ? nameInput.value.trim()   : "";
      var numberVal = numberInput ? numberInput.value.trim() : "";

      var items = [
        feat.logo    ? ["Club Badge",    frontState.logoSrc    ? "Added" : "None"] : null,
        feat.sponsor ? ["Front Sponsor", frontState.sponsorSrc ? "Added" : "None"] : null,
        feat.name    ? ["Player Name",   nameVal   || "None"]                      : null,
        feat.number  ? ["Jersey Number", numberVal || "None"]                      : null,
      ].filter(Boolean);

      items.forEach(function (pair) {
        var li     = document.createElement("li");
        var strong = document.createElement("strong");
        strong.textContent = pair[0] + ": ";
        li.appendChild(strong);
        li.appendChild(document.createTextNode(pair[1]));
        list.appendChild(li);
      });
    }

    // ── Lightbox ────────────────────────────────────────────────
    var lb = initLightbox();

    [canvasFront, canvasBack].forEach(function (container) {
      if (!container) return;
      var preview = container.querySelector(".jersey-customizer__preview");
      if (!preview) return;
      preview.addEventListener("click", function () {
        // Only open when in review side-by-side mode
        if (!canvasesEl.classList.contains("jcw__canvases--review")) return;
        lb.open(preview);
      });
    });

    // ── Boot ───────────────────────────────────────────────────
    goToStep("intro");
  }

  // ════════════════════════════════════════════════════════════
  //  LIGHTBOX
  // ════════════════════════════════════════════════════════════

  /**
   * Create a reusable lightbox and append it to <body>.
   *
   * Appended to body (not inside the widget) so it is never clipped by an
   * overflow:hidden ancestor in the theme's product page layout.
   *
   * Returns { open(previewEl), close() }.
   */
  function initLightbox() {
    // ── Build DOM ────────────────────────────────────────────────
    var lb = document.createElement("div");
    lb.className = "jcw__lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Jersey preview");
    lb.innerHTML =
      '<div class="jcw__lightbox-backdrop" data-lb-close></div>' +
      '<div class="jcw__lightbox-content">' +
      '  <button class="jcw__lightbox-close" data-lb-close type="button" aria-label="Close preview">&#x2715;</button>' +
      '  <div class="jcw__lightbox-frame"></div>' +
      '</div>';
    document.body.appendChild(lb);

    var frame    = lb.querySelector(".jcw__lightbox-frame");
    var closeBtn = lb.querySelector(".jcw__lightbox-close");

    // ── Open / close ─────────────────────────────────────────────

    function open(previewEl) {
      // Deep-clone the preview div — all inline styles (left/top/width on
      // overlays) and loaded image srcs are preserved in the clone.
      var clone = previewEl.cloneNode(true);
      frame.innerHTML = "";
      frame.appendChild(clone);

      lb.classList.add("jcw__lightbox--open");
      document.body.style.overflow = "hidden";

      // Move focus to the close button for keyboard users
      closeBtn.focus();
    }

    function close() {
      lb.classList.remove("jcw__lightbox--open");
      document.body.style.overflow = "";

      // Clear the clone after the fade-out transition finishes
      setTimeout(function () {
        if (!lb.classList.contains("jcw__lightbox--open")) {
          frame.innerHTML = "";
        }
      }, 250);
    }

    // ── Event listeners ──────────────────────────────────────────

    lb.querySelectorAll("[data-lb-close]").forEach(function (el) {
      el.addEventListener("click", close);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && lb.classList.contains("jcw__lightbox--open")) {
        close();
      }
    });

    return { open: open, close: close };
  }

})();
