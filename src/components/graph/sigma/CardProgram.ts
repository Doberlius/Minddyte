import { NodeProgram } from 'sigma/rendering'
import { floatColor } from 'sigma/utils'
import type { NodeDisplayData, RenderParams } from 'sigma/types'
import type { ProgramInfo } from 'sigma/rendering'

/**
 * How Sigma draws a chat card or a concept pill: one rounded rectangle per
 * node, with a 1px border and a soft shadow, all of them in one draw call.
 *
 * Sigma's stock nodes are circles. Rather than fork Sigma, this is its own
 * circle program with two things swapped: the triangle each circle is cut
 * from becomes a rectangle (two triangles, six corners), and the "is this
 * pixel inside the circle" test becomes "is it inside a rounded box". Both
 * tests are signed distances, which is what gives the edge its smooth
 * anti-aliasing for free.
 *
 * What each node passes in, beyond Sigma's own x, y, size and colour:
 *
 * - `aspect`: width over height. A chat card is 2 (208×104); a pill is as
 *   wide as its label.
 * - `radius`: the corner, as a fraction of half the height. 1 is fully round,
 *   which is a pill.
 * - `borderColor`: the 1px outline.
 * - `fadeFrom` / `fadeTo`: the zoom range over which the node fades in (both
 *   0: always drawn). The shader works out the current zoom itself, so a
 *   fade costs nothing per frame: no attribute is rewritten while you zoom.
 *
 * The text is NOT drawn here. WebGL has no text; `drawCard.ts` writes it on
 * Sigma's label canvas, which sits just above this layer.
 */

/** WebGL's numeric constants, written out so this file never touches `window` at import time. */
const FLOAT = 5126
const UNSIGNED_BYTE = 5121
const TRIANGLES = 4

const VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec4 a_border;
attribute vec2 a_position;
attribute float a_size;
attribute float a_aspect;
attribute float a_radius;
attribute float a_fadeFrom;
attribute float a_fadeTo;
attribute vec2 a_corner;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec4 v_border;
varying vec2 v_local;
varying vec2 v_half;
varying float v_radius;
varying float v_px;
varying float v_fade;

const float bias = 255.0 / 254.0;
// How far past the box the quad reaches, so the shadow has room to fade.
const float SHADOW = 0.16;

void main() {
  // Screen pixels per graph unit, the same k drawCard uses for the text,
  // so a pill and its label fade together.
  float k = 1.0 / u_sizeRatio;
  v_fade = a_fadeTo <= 0.0 ? 1.0 : smoothstep(a_fadeFrom, a_fadeTo, k);
  if (v_fade <= 0.001) {
    // Invisible: collapse the quad off-screen, so the GPU does no pixel work
    // for it at all. Zoomed out, that is most of the nodes in a big graph.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // The same size rule as Sigma's circle: a node of size s is s pixels from
  // its centre to its top edge, at the current zoom.
  float halfH = a_size * u_correctionRatio / u_sizeRatio * 2.0;
  vec2 halfExt = vec2(a_aspect, 1.0);
  vec2 local = a_corner * (halfExt + SHADOW);
  gl_Position = vec4((u_matrix * vec3(a_position + local * halfH, 1.0)).xy, 0.0, 1.0);

  v_local = local;
  v_half = halfExt;
  v_radius = a_radius;
  // One screen pixel, in the box's own units: the width of the soft edge.
  v_px = 2.0 * u_correctionRatio / halfH;

  #ifdef PICKING_MODE
  v_color = a_id;
  v_border = a_id;
  #else
  v_color = a_color;
  v_border = a_border;
  #endif

  v_color.a *= bias;
  v_border.a *= bias;
}
`

const FRAGMENT = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec4 v_border;
varying vec2 v_local;
varying vec2 v_half;
varying float v_radius;
varying float v_px;
varying float v_fade;

// Signed distance to a rounded box: negative inside, positive outside.
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(void) {
  float d = box(v_local, v_half, min(v_radius, 1.0));

  #ifdef PICKING_MODE
  // Clicks: only the box itself counts, never its shadow, and never a node
  // still too faint to see.
  if (d > 0.0 || v_fade < 0.5) discard;
  gl_FragColor = v_color;
  #else
  float edge = clamp(0.5 - d / v_px, 0.0, 1.0);
  // The outermost 1.5 pixels inside the edge are the border.
  float inBorder = clamp((d + 1.5 * v_px) / v_px, 0.0, 1.0);
  vec4 c = mix(v_color, v_border, inBorder);
  float shadowA = 0.07 * (1.0 - smoothstep(0.0, 0.16, d));
  float a = (c.a * edge + shadowA * (1.0 - edge)) * v_fade;
  gl_FragColor = vec4(c.rgb * c.a * edge * v_fade, a);
  #endif
}
`

const UNIFORMS = ['u_sizeRatio', 'u_correctionRatio', 'u_matrix'] as const
type Uniform = (typeof UNIFORMS)[number]

/** The extra attributes this program reads off a node. */
export type CardShape = { aspect?: number; radius?: number; borderColor?: string; fadeFrom?: number; fadeTo?: number }

export class CardProgram extends NodeProgram<Uniform> {
  getDefinition() {
    return {
      VERTICES: 6,
      VERTEX_SHADER_SOURCE: VERTEX,
      FRAGMENT_SHADER_SOURCE: FRAGMENT,
      METHOD: TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: 'a_position', size: 2, type: FLOAT },
        { name: 'a_size', size: 1, type: FLOAT },
        { name: 'a_aspect', size: 1, type: FLOAT },
        { name: 'a_radius', size: 1, type: FLOAT },
        { name: 'a_fadeFrom', size: 1, type: FLOAT },
        { name: 'a_fadeTo', size: 1, type: FLOAT },
        { name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: 'a_border', size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [{ name: 'a_corner', size: 2, type: FLOAT }],
      // Two triangles that make the rectangle.
      CONSTANT_DATA: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ],
    }
  }

  processVisibleItem(nodeIndex: number, i: number, data: NodeDisplayData) {
    const shape = data as NodeDisplayData & CardShape
    const a = this.array
    a[i++] = data.x
    a[i++] = data.y
    a[i++] = data.size
    a[i++] = shape.aspect ?? 1
    a[i++] = shape.radius ?? 1
    a[i++] = shape.fadeFrom ?? 0
    a[i++] = shape.fadeTo ?? 0
    a[i++] = floatColor(data.color)
    a[i++] = floatColor(shape.borderColor ?? data.color)
    a[i++] = nodeIndex
  }

  setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>) {
    gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio)
    gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio)
    gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix)
  }
}

/**
 * The program for Sigma's hover layer, which draws nothing.
 *
 * Sigma paints a hovered (or highlighted) node a second time, in WebGL, on a
 * layer ABOVE the label canvas. A dot's label sits beside the dot, so that is
 * harmless for stock nodes. A card's text sits INSIDE the card, so the second
 * copy covered it: hover a card and its title vanished. The card on the main
 * layer is already exactly right, so the hover copy is simply skipped and the
 * hover shows as the ring `drawCardHover` adds on its own canvas.
 */
export class NoHoverProgram extends CardProgram {
  render() {}
}
