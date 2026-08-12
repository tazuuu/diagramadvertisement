/* =============================================================================
   Liquid Hover — cursor-driven fluid distortion (vanilla JS port)

   A GPU Navier-Stokes solver (splat -> divergence -> Jacobi pressure ->
   gradient subtract -> advection) runs on a low-res velocity field. Pointer
   movement injects velocity + "ink"; the display pass then offsets the image
   UVs along the velocity direction, proportional to the ink amount.

   The canvas is drawn at 120% of the container (10% bleed on every side) so
   ripples can travel past the image edge instead of clipping. INNER_SCALE
   (1 / 1.2) maps the centre 100% region back onto the image.

   Usage:
     <div class="hero-liquid" data-liquid-hover data-src="assets/hero.png">
       <img src="assets/hero.png" alt="">   <!-- fallback, hidden on success -->
     </div>

   Optional data attributes: data-resolution (1-10), data-cursor-size (0.1-1),
   data-cursor-power (0.1-1), data-distortion (0.1-1).

   Progressive enhancement: if WebGL or float textures are unavailable the
   fallback <img> simply stays visible.
   ============================================================================= */

(function () {
    "use strict"

    // -- Constants -----------------------------------------------------------

    var CANVAS_OVERSCAN = 1.2 // canvas is 120% of the container
    var INNER_SCALE = 1 / CANVAS_OVERSCAN // 0.8333... - image occupies the centre
    var MAX_DPR = 2
    var PRESSURE_ITERATIONS = 16
    var VELOCITY_DISSIPATION = 0.97
    var INK_DISSIPATION = 0.98
    var INK_ADVECT_MULTIPLIER = 8
    var POINTER_VELOCITY_GAIN = 6
    var FIXED_DT = 1 / 60
    var SIM_BASE_RESOLUTION = 128
    var SIM_RESOLUTION_RANGE = 384

    // -- Shaders -------------------------------------------------------------

    var vertexShader = [
        "precision highp float;",
        "varying vec2 vUv;",
        "attribute vec2 a_position;",
        "varying vec2 vL;",
        "varying vec2 vR;",
        "varying vec2 vT;",
        "varying vec2 vB;",
        "uniform vec2 u_texel;",
        "void main () {",
        "  vUv = .5 * (a_position + 1.);",
        "  vL = vUv - vec2(u_texel.x, 0.);",
        "  vR = vUv + vec2(u_texel.x, 0.);",
        "  vT = vUv + vec2(0., u_texel.y);",
        "  vB = vUv - vec2(0., u_texel.y);",
        "  gl_Position = vec4(a_position, 0., 1.);",
        "}",
    ].join("\n")

    var splatShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying vec2 vUv;",
        "uniform sampler2D u_input_texture;",
        "uniform float u_ratio;",
        "uniform vec3 u_point_value;",
        "uniform vec2 u_point;",
        "uniform float u_point_size;",
        "void main () {",
        "  vec2 p = vUv - u_point.xy;",
        "  p.x *= u_ratio;",
        "  vec3 splat = .6 * pow(2., -dot(p, p) / u_point_size) * u_point_value;",
        "  vec3 base = texture2D(u_input_texture, vUv).xyz;",
        "  gl_FragColor = vec4(base + splat, 1.);",
        "}",
    ].join("\n")

    var divergenceShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying highp vec2 vUv;",
        "varying highp vec2 vL;",
        "varying highp vec2 vR;",
        "varying highp vec2 vT;",
        "varying highp vec2 vB;",
        "uniform sampler2D u_velocity_texture;",
        "void main () {",
        "  float L = texture2D(u_velocity_texture, vL).x;",
        "  float R = texture2D(u_velocity_texture, vR).x;",
        "  float T = texture2D(u_velocity_texture, vT).y;",
        "  float B = texture2D(u_velocity_texture, vB).y;",
        "  float div = .25 * (R - L + T - B);",
        "  gl_FragColor = vec4(div, 0., 0., 1.);",
        "}",
    ].join("\n")

    var pressureShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying highp vec2 vUv;",
        "varying highp vec2 vL;",
        "varying highp vec2 vR;",
        "varying highp vec2 vT;",
        "varying highp vec2 vB;",
        "uniform sampler2D u_pressure_texture;",
        "uniform sampler2D u_divergence_texture;",
        "void main () {",
        "  float L = texture2D(u_pressure_texture, vL).x;",
        "  float R = texture2D(u_pressure_texture, vR).x;",
        "  float T = texture2D(u_pressure_texture, vT).x;",
        "  float B = texture2D(u_pressure_texture, vB).x;",
        "  float divergence = texture2D(u_divergence_texture, vUv).x;",
        "  float pressure = (L + R + B + T - divergence) * .25;",
        "  gl_FragColor = vec4(pressure, 0., 0., 1.);",
        "}",
    ].join("\n")

    var gradientSubtractShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying highp vec2 vUv;",
        "varying highp vec2 vL;",
        "varying highp vec2 vR;",
        "varying highp vec2 vT;",
        "varying highp vec2 vB;",
        "uniform sampler2D u_pressure_texture;",
        "uniform sampler2D u_velocity_texture;",
        "void main () {",
        "  float L = texture2D(u_pressure_texture, vL).x;",
        "  float R = texture2D(u_pressure_texture, vR).x;",
        "  float T = texture2D(u_pressure_texture, vT).x;",
        "  float B = texture2D(u_pressure_texture, vB).x;",
        "  vec2 velocity = texture2D(u_velocity_texture, vUv).xy;",
        "  velocity.xy -= vec2(R - L, T - B);",
        "  gl_FragColor = vec4(velocity, 0., 1.);",
        "}",
    ].join("\n")

    var advectionShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying vec2 vUv;",
        "uniform sampler2D u_velocity_texture;",
        "uniform sampler2D u_input_texture;",
        "uniform vec2 u_texel;",
        "uniform vec2 u_output_textel;",
        "uniform float u_dt;",
        "uniform float u_dissipation;",
        "vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {",
        "  vec2 st = uv / tsize - 0.5;",
        "  vec2 iuv = floor(st);",
        "  vec2 fuv = fract(st);",
        "  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);",
        "  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);",
        "  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);",
        "  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);",
        "  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);",
        "}",
        "void main () {",
        "  vec2 coord = vUv - u_dt * bilerp(u_velocity_texture, vUv, u_texel).xy * u_texel;",
        "  vec4 velocity = bilerp(u_input_texture, coord, u_output_textel);",
        "  gl_FragColor = u_dissipation * velocity;",
        "}",
    ].join("\n")

    var displayShader = [
        "precision highp float;",
        "precision highp sampler2D;",
        "varying vec2 vUv;",
        "uniform float u_ratio;",
        "uniform float u_img_ratio;",
        "uniform float u_disturb_power;",
        "uniform sampler2D u_output_texture;",
        "uniform sampler2D u_velocity_texture;",
        "uniform sampler2D u_text_texture;",
        "uniform vec2 u_point;",
        "uniform float u_canvas_scale;",
        "uniform float u_inner_scale;",

        // Canvas UV -> image UV, with an object-fit: cover mapping.
        "vec2 get_img_uv() {",
        "  vec2 uv = vUv - 0.5;",
        "  uv *= u_canvas_scale;",
        "  uv /= u_inner_scale;",
        "  float containerAspect = u_ratio;",
        "  float imageAspect = u_img_ratio;",
        "  vec2 scale = vec2(1.0);",
        "  if (containerAspect > imageAspect) {",
        "    scale.y = imageAspect / containerAspect;",
        "  } else {",
        "    scale.x = containerAspect / imageAspect;",
        "  }",
        "  uv *= scale;",
        "  return uv + 0.5;",
        "}",

        // Frame UVs define the inner rectangle region (no cover scaling).
        "vec2 get_frame_uv() {",
        "  vec2 uv = vUv - 0.5;",
        "  uv *= u_canvas_scale;",
        "  uv /= u_inner_scale;",
        "  return uv + 0.5;",
        "}",

        "float get_img_frame_alpha(vec2 uv, float img_frame_width) {",
        "  float a = smoothstep(0., img_frame_width, uv.x) * smoothstep(1., 1. - img_frame_width, uv.x);",
        "  a *= smoothstep(0., img_frame_width, uv.y) * smoothstep(1., 1. - img_frame_width, uv.y);",
        "  return a;",
        "}",

        // Blur when sampling outside bounds, to avoid smearing one edge pixel.
        "vec3 sample_image_smooth(vec2 uv) {",
        "  vec2 uvc = clamp(uv, 0.0, 1.0);",
        "  vec3 base = texture2D(u_text_texture, vec2(uvc.x, 1.0 - uvc.y)).rgb;",
        "  float outOfBounds = max(max(step(uv.y, 0.0), step(1.0, uv.y)), max(step(uv.x, 0.0), step(1.0, uv.x)));",
        "  if (outOfBounds > 0.0) {",
        "    float d = 0.002;",
        "    vec3 sum = vec3(0.0);",
        "    for (int i = -1; i <= 1; i++) {",
        "      for (int j = -1; j <= 1; j++) {",
        "        vec2 o = vec2(float(i), float(j)) * d;",
        "        vec2 s = clamp(uvc + o, 0.0, 1.0);",
        "        sum += texture2D(u_text_texture, vec2(s.x, 1.0 - s.y)).rgb;",
        "      }",
        "    }",
        "    base = sum / 9.0;",
        "  }",
        "  return base;",
        "}",

        "void main () {",
        "  float offset = texture2D(u_output_texture, vUv).r;",
        "  vec2 velocity = texture2D(u_velocity_texture, vUv).xy;",
        "  velocity += .001;",
        "  vec2 push = u_disturb_power * normalize(velocity) * offset;",
        "  vec2 img_uv = get_img_uv() - 2.0 * push;",
        "  vec2 frame_uv = get_frame_uv() - push;",
        "  vec3 img = sample_image_smooth(img_uv);",
        "  float opacity = get_img_frame_alpha(frame_uv, .002);",
        "  gl_FragColor = vec4(img * opacity, opacity);",
        "}",
    ].join("\n")

    // -- Helpers -------------------------------------------------------------

    function readNumber(el, attr, fallback) {
        var raw = el.getAttribute(attr)
        if (raw === null || raw === "") return fallback
        var value = parseFloat(raw)
        return isNaN(value) ? fallback : value
    }

    // -- Instance ------------------------------------------------------------

    function createLiquidHover(container) {
        var src = container.getAttribute("data-src")
        if (!src) return

        var resolution = readNumber(container, "data-resolution", 5)
        var cursorSizeInput = readNumber(container, "data-cursor-size", 0.5)
        var cursorPowerInput = readNumber(container, "data-cursor-power", 0.5)
        var distortionPower = readNumber(container, "data-distortion", 0.4)

        var canvas = document.createElement("canvas")
        canvas.className = "liquid-hover-canvas"
        canvas.setAttribute("aria-hidden", "true")
        container.appendChild(canvas)

        var gl = canvas.getContext("webgl", { alpha: true })
        if (!gl) {
            container.removeChild(canvas)
            return
        }

        // The velocity/pressure fields need a render target with more than 8
        // bits per channel. Support for this is the single biggest portability
        // trap on mobile: iOS Safari and plenty of Android GPUs advertise
        // OES_texture_float (they can *sample* float textures) while being
        // unable to *render* to one. Asking the extension is therefore not
        // enough — we build a 1x1 target of each candidate format and keep the
        // first one the driver reports as framebuffer-complete.
        var floatExt = gl.getExtension("OES_texture_float")
        var halfFloatExt = gl.getExtension("OES_texture_half_float")
        var HALF_FLOAT = halfFloatExt ? halfFloatExt.HALF_FLOAT_OES : null

        function canRenderTo(format, type) {
            if (type === null || type === undefined) return false
            var tex = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 1, 0, format, type, null)
            var fb = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                tex,
                0
            )
            var ok =
                gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.deleteFramebuffer(fb)
            gl.deleteTexture(tex)
            return ok
        }

        // Half-float first: it is enough precision for this simulation, and it
        // is what mobile GPUs can actually render to. RGBA is more widely
        // renderable than RGB, so it is the fallback within each type.
        var candidates = [
            { format: gl.RGBA, type: HALF_FLOAT, linear: "OES_texture_half_float_linear" },
            { format: gl.RGB, type: HALF_FLOAT, linear: "OES_texture_half_float_linear" },
            { format: gl.RGBA, type: floatExt ? gl.FLOAT : null, linear: "OES_texture_float_linear" },
            { format: gl.RGB, type: floatExt ? gl.FLOAT : null, linear: "OES_texture_float_linear" },
        ]
        var target = null
        for (var ci = 0; ci < candidates.length; ci++) {
            if (canRenderTo(candidates[ci].format, candidates[ci].type)) {
                target = candidates[ci]
                break
            }
        }
        if (!target) {
            container.removeChild(canvas)
            return
        }
        // Without the matching linear extension the driver silently fails to
        // filter, so fall back to NEAREST rather than rendering garbage.
        var simFilter = gl.getExtension(target.linear) ? gl.LINEAR : gl.NEAREST

        gl.clearColor(0, 0, 0, 0)

        // Map the 0.1-1 authoring range onto the values the shaders expect.
        var config = {
            cursorSize: 0.5 + ((cursorSizeInput - 0.1) * 4.5) / 0.9, // 0.5 - 5
            cursorPower: 5 + ((cursorPowerInput - 0.1) * 45) / 0.9, // 5 - 50
            distortionPower: distortionPower,
        }

        var pointer = {
            x: 0.65 * container.clientWidth,
            y: 0.5 * container.clientHeight,
            dx: 0,
            dy: 0,
            moved: false,
        }
        var simSize = { w: 0, h: 0 }

        var ink, velocity, divergence, pressure
        var imageTexture = null
        var imageAspect = 1
        var isPointerActive = false
        var rafId = null
        var aborted = false

        // -- GL helpers ------------------------------------------------------

        function compileShader(source, type) {
            var shader = gl.createShader(type)
            gl.shaderSource(shader, source)
            gl.compileShader(shader)
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                var log = gl.getShaderInfoLog(shader)
                gl.deleteShader(shader)
                throw new Error(log || "Shader compile error")
            }
            return shader
        }

        function createProgram(vs, fs) {
            var program = gl.createProgram()
            gl.attachShader(program, compileShader(vs, gl.VERTEX_SHADER))
            gl.attachShader(program, compileShader(fs, gl.FRAGMENT_SHADER))
            gl.bindAttribLocation(program, 0, "a_position")
            gl.linkProgram(program)
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(gl.getProgramInfoLog(program) || "Program link error")
            }

            var uniforms = {}
            var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
            for (var i = 0; i < count; i++) {
                var info = gl.getActiveUniform(program, i)
                if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name)
            }
            return { program: program, uniforms: uniforms }
        }

        // The full-screen quad is uploaded once and reused by every blit.
        var vertexBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
            gl.STATIC_DRAW
        )
        var indexBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array([0, 1, 2, 0, 2, 3]),
            gl.STATIC_DRAW
        )
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
        gl.enableVertexAttribArray(0)

        /** Draws the quad into `target`, or into the canvas when null. */
        function blit(target) {
            if (!target) {
                gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
                gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            } else {
                gl.viewport(0, 0, target.width, target.height)
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            }
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
        }

        function createFBO(w, h) {
            gl.activeTexture(gl.TEXTURE0)
            var texture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, simFilter)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, simFilter)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                target.format,
                w,
                h,
                0,
                target.format,
                target.type,
                null
            )

            var fbo = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                texture,
                0
            )
            gl.viewport(0, 0, w, h)
            gl.clear(gl.COLOR_BUFFER_BIT)

            return {
                fbo: fbo,
                texture: texture,
                width: w,
                height: h,
                attach: function (unit) {
                    gl.activeTexture(gl.TEXTURE0 + unit)
                    gl.bindTexture(gl.TEXTURE_2D, texture)
                    return unit
                },
            }
        }

        function createDoubleFBO(w, h) {
            var front = createFBO(w, h)
            var back = createFBO(w, h)
            return {
                width: w,
                height: h,
                texelSizeX: 1 / w,
                texelSizeY: 1 / h,
                read: function () {
                    return front
                },
                write: function () {
                    return back
                },
                swap: function () {
                    var tmp = front
                    front = back
                    back = tmp
                },
                dispose: function () {
                    gl.deleteFramebuffer(front.fbo)
                    gl.deleteTexture(front.texture)
                    gl.deleteFramebuffer(back.fbo)
                    gl.deleteTexture(back.texture)
                },
            }
        }

        // -- Programs --------------------------------------------------------

        var splatProgram, divergenceProgram, pressureProgram
        var gradientProgram, advectionProgram, displayProgram
        try {
            splatProgram = createProgram(vertexShader, splatShader)
            divergenceProgram = createProgram(vertexShader, divergenceShader)
            pressureProgram = createProgram(vertexShader, pressureShader)
            gradientProgram = createProgram(vertexShader, gradientSubtractShader)
            advectionProgram = createProgram(vertexShader, advectionShader)
            displayProgram = createProgram(vertexShader, displayShader)
        } catch (err) {
            container.removeChild(canvas)
            return
        }

        // -- Sizing ----------------------------------------------------------

        function resizeCanvas() {
            var cssWidth = container.clientWidth
            var cssHeight = container.clientHeight
            var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)

            canvas.width = Math.max(2, Math.round(cssWidth * CANVAS_OVERSCAN * dpr))
            canvas.height = Math.max(2, Math.round(cssHeight * CANVAS_OVERSCAN * dpr))

            var drawWidth = cssWidth * CANVAS_OVERSCAN
            var drawHeight = cssHeight * CANVAS_OVERSCAN
            canvas.style.width = drawWidth + "px"
            canvas.style.height = drawHeight + "px"

            var aspect = drawWidth / Math.max(1, drawHeight)
            var simHeight =
                SIM_BASE_RESOLUTION + ((resolution - 1) * SIM_RESOLUTION_RANGE) / 9
            simSize.w = Math.max(2, Math.round(simHeight * aspect))
            simSize.h = Math.max(2, Math.round(simHeight))
        }

        function initFBOs() {
            if (ink) ink.dispose()
            if (velocity) velocity.dispose()
            if (pressure) pressure.dispose()
            if (divergence) {
                gl.deleteFramebuffer(divergence.fbo)
                gl.deleteTexture(divergence.texture)
            }
            ink = createDoubleFBO(simSize.w, simSize.h)
            velocity = createDoubleFBO(simSize.w, simSize.h)
            divergence = createFBO(simSize.w, simSize.h)
            pressure = createDoubleFBO(simSize.w, simSize.h)
        }

        /** Pointer position in canvas UV space, accounting for the overscan. */
        function getPointerUV() {
            var w = container.clientWidth * CANVAS_OVERSCAN
            var h = container.clientHeight * CANVAS_OVERSCAN
            var offsetX = 0.5 * (w - container.clientWidth)
            var offsetY = 0.5 * (h - container.clientHeight)
            return {
                u: (pointer.x + offsetX) / w,
                v: 1 - (pointer.y + offsetY) / h,
            }
        }

        function updatePointer(x, y) {
            pointer.moved = true
            pointer.dx = POINTER_VELOCITY_GAIN * (x - pointer.x)
            pointer.dy = POINTER_VELOCITY_GAIN * (y - pointer.y)
            pointer.x = x
            pointer.y = y
        }

        // -- Events ----------------------------------------------------------

        function onEnter() {
            isPointerActive = true
        }

        function onLeave() {
            isPointerActive = false
            pointer.moved = false
        }

        // The canvas sits behind the hero copy, so pointer input is tracked on
        // the whole hero and translated into container-local coordinates.
        function onMouseMove(e) {
            if (!isPointerActive) return
            var rect = container.getBoundingClientRect()
            updatePointer(e.clientX - rect.left, e.clientY - rect.top)
        }

        // Passive on purpose: never call preventDefault here, or the hero would
        // swallow vertical page scrolling on touch devices.
        function onTouchMove(e) {
            var touch = e.targetTouches[0]
            if (!touch) return
            isPointerActive = true
            var rect = container.getBoundingClientRect()
            updatePointer(touch.clientX - rect.left, touch.clientY - rect.top)
        }

        function onTouchEnd() {
            isPointerActive = false
            pointer.moved = false
        }

        function onResize() {
            resizeCanvas()
            initFBOs()
        }

        var host = container.parentElement || container
        host.addEventListener("mouseenter", onEnter)
        host.addEventListener("mouseleave", onLeave)
        host.addEventListener("mousemove", onMouseMove)
        host.addEventListener("touchstart", onTouchMove, { passive: true })
        host.addEventListener("touchmove", onTouchMove, { passive: true })
        host.addEventListener("touchend", onTouchEnd, { passive: true })
        window.addEventListener("resize", onResize)

        if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(onResize).observe(container)
        }

        // Stop the solver whenever the hero is off-screen or the tab is hidden.
        var isVisible = true
        if (typeof IntersectionObserver !== "undefined") {
            new IntersectionObserver(function (entries) {
                isVisible = entries[0].isIntersecting
                syncLoop()
            }).observe(container)
        }
        document.addEventListener("visibilitychange", syncLoop)

        function syncLoop() {
            if (aborted) return
            var shouldRun = isVisible && !document.hidden
            if (shouldRun && rafId === null) {
                rafId = requestAnimationFrame(render)
            } else if (!shouldRun && rafId !== null) {
                cancelAnimationFrame(rafId)
                rafId = null
            }
        }

        // Every failure after init lands here. The canvas sits on top of the
        // fallback <img>, so leaving an empty one behind blacks out the hero —
        // it must come out of the DOM, not just stop rendering.
        function abort() {
            if (aborted) return
            aborted = true
            if (rafId !== null) {
                cancelAnimationFrame(rafId)
                rafId = null
            }
            container.classList.remove("is-live")
            // Marks the hero as a still frame, so the "move your cursor" hint
            // can hide itself rather than promise an interaction that is gone.
            container.classList.add("is-static")
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        }

        // -- Image texture ---------------------------------------------------

        function loadImage(url) {
            var img = new Image()
            // Only opt into CORS for genuinely cross-origin URLs. Requesting it
            // for a same-origin asset gains nothing, and over file:// (where the
            // origin is "null") it makes the request fail outright.
            if (/^(https?:)?\/\//i.test(url) && url.indexOf(location.origin + "/") !== 0) {
                img.crossOrigin = "anonymous"
            }
            img.onload = function () {
                imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight)
                imageTexture = gl.createTexture()
                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, imageTexture)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
                try {
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
                } catch (err) {
                    // A tainted source (file://, or a host that serves no CORS
                    // headers) makes texImage2D throw SecurityError.
                    abort()
                    return
                }
                // Only hide the fallback once the GPU actually has the pixels.
                container.classList.add("is-live")
            }
            img.onerror = abort
            img.src = url
        }

        // -- Simulation step -------------------------------------------------

        function render() {
            rafId = requestAnimationFrame(render)

            var containerAspect =
                container.clientWidth / Math.max(1, container.clientHeight)

            // 1. Inject velocity + ink at the pointer
            if (pointer.moved) {
                pointer.moved = false
                gl.useProgram(splatProgram.program)
                gl.uniform1i(
                    splatProgram.uniforms.u_input_texture,
                    velocity.read().attach(1)
                )
                gl.uniform1f(splatProgram.uniforms.u_ratio, containerAspect)

                var splatUV = getPointerUV()
                gl.uniform2f(splatProgram.uniforms.u_point, splatUV.u, splatUV.v)
                gl.uniform3f(
                    splatProgram.uniforms.u_point_value,
                    pointer.dx,
                    -pointer.dy,
                    0
                )
                gl.uniform1f(
                    splatProgram.uniforms.u_point_size,
                    config.cursorSize * 0.001
                )
                blit(velocity.write())
                velocity.swap()

                gl.uniform1i(splatProgram.uniforms.u_input_texture, ink.read().attach(1))
                gl.uniform3f(
                    splatProgram.uniforms.u_point_value,
                    config.cursorPower * 0.001,
                    0,
                    0
                )
                blit(ink.write())
                ink.swap()
            }

            // 2. Divergence of the velocity field
            gl.useProgram(divergenceProgram.program)
            gl.uniform2f(
                divergenceProgram.uniforms.u_texel,
                velocity.texelSizeX,
                velocity.texelSizeY
            )
            gl.uniform1i(
                divergenceProgram.uniforms.u_velocity_texture,
                velocity.read().attach(1)
            )
            blit(divergence)

            // 3. Jacobi pressure solve
            gl.useProgram(pressureProgram.program)
            gl.uniform2f(
                pressureProgram.uniforms.u_texel,
                velocity.texelSizeX,
                velocity.texelSizeY
            )
            gl.uniform1i(
                pressureProgram.uniforms.u_divergence_texture,
                divergence.attach(1)
            )
            for (var i = 0; i < PRESSURE_ITERATIONS; i++) {
                gl.uniform1i(
                    pressureProgram.uniforms.u_pressure_texture,
                    pressure.read().attach(2)
                )
                blit(pressure.write())
                pressure.swap()
            }

            // 4. Make the velocity field divergence-free
            gl.useProgram(gradientProgram.program)
            gl.uniform2f(
                gradientProgram.uniforms.u_texel,
                velocity.texelSizeX,
                velocity.texelSizeY
            )
            gl.uniform1i(
                gradientProgram.uniforms.u_pressure_texture,
                pressure.read().attach(1)
            )
            gl.uniform1i(
                gradientProgram.uniforms.u_velocity_texture,
                velocity.read().attach(2)
            )
            blit(velocity.write())
            velocity.swap()

            // 5a. Self-advect the velocity
            gl.useProgram(advectionProgram.program)
            gl.uniform2f(
                advectionProgram.uniforms.u_texel,
                velocity.texelSizeX,
                velocity.texelSizeY
            )
            gl.uniform2f(
                advectionProgram.uniforms.u_output_textel,
                velocity.texelSizeX,
                velocity.texelSizeY
            )
            gl.uniform1i(
                advectionProgram.uniforms.u_velocity_texture,
                velocity.read().attach(1)
            )
            gl.uniform1i(
                advectionProgram.uniforms.u_input_texture,
                velocity.read().attach(1)
            )
            gl.uniform1f(advectionProgram.uniforms.u_dt, FIXED_DT)
            gl.uniform1f(advectionProgram.uniforms.u_dissipation, VELOCITY_DISSIPATION)
            blit(velocity.write())
            velocity.swap()

            // 5b. Advect the ink along the (still bound) velocity field
            gl.uniform2f(
                advectionProgram.uniforms.u_output_textel,
                ink.texelSizeX,
                ink.texelSizeY
            )
            gl.uniform1i(advectionProgram.uniforms.u_input_texture, ink.read().attach(2))
            gl.uniform1f(advectionProgram.uniforms.u_dt, INK_ADVECT_MULTIPLIER * FIXED_DT)
            gl.uniform1f(advectionProgram.uniforms.u_dissipation, INK_DISSIPATION)
            blit(ink.write())
            ink.swap()

            // 6. Draw the distorted image
            gl.useProgram(displayProgram.program)
            var displayUV = getPointerUV()
            gl.uniform2f(displayProgram.uniforms.u_point, displayUV.u, displayUV.v)
            gl.uniform1i(
                displayProgram.uniforms.u_velocity_texture,
                velocity.read().attach(2)
            )
            gl.uniform1f(displayProgram.uniforms.u_ratio, containerAspect)
            gl.uniform1f(displayProgram.uniforms.u_img_ratio, imageAspect)
            gl.uniform1f(
                displayProgram.uniforms.u_disturb_power,
                config.distortionPower
            )
            gl.uniform1i(displayProgram.uniforms.u_output_texture, ink.read().attach(1))
            gl.uniform1f(displayProgram.uniforms.u_canvas_scale, 1)
            gl.uniform1f(displayProgram.uniforms.u_inner_scale, INNER_SCALE)
            if (imageTexture) {
                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, imageTexture)
                gl.uniform1i(displayProgram.uniforms.u_text_texture, 0)
            }
            blit(null)
        }

        // -- Boot ------------------------------------------------------------

        resizeCanvas()
        initFBOs()
        loadImage(src)
        syncLoop()
    }

    function prefersReducedMotion() {
        return (
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
    }

    function init() {
        // Leave the still fallback in place rather than run the solver.
        if (prefersReducedMotion()) return

        var nodes = document.querySelectorAll("[data-liquid-hover]")
        for (var i = 0; i < nodes.length; i++) {
            try {
                createLiquidHover(nodes[i])
            } catch (err) {
                // Any failure leaves the fallback <img> in place.
                if (window.console) console.warn("LiquidHover:", err)
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init)
    } else {
        init()
    }
})()
