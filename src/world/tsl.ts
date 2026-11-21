// TSL, untyped. The shading language's typings fight every expression; the shaders are checked by
// compiling and looking at them instead (every material is compiled before play).
import * as TSL from 'three/tsl'
const T = TSL as unknown as Record<string, any>
export const {
  Fn, If, Loop, Discard, attribute, uniform, texture, varying, vertexStage,
  positionLocal, positionWorld, positionView, positionGeometry, normalLocal, normalWorld, normalView, cameraPosition,
  diffuseColor, output, screenUV, screenCoordinate, viewportDepthTexture, viewportLinearDepth, linearDepth, viewportSharedTexture,
  cameraNear, cameraFar, perspectiveDepthToViewZ, modelWorldMatrix, cameraViewMatrix, frontFacing, instanceIndex, vertexIndex,
  vec2, vec3, vec4, float, int, mix, smoothstep, step, sin, cos, max, min, dot, cross, exp, pow, abs, clamp, fract, floor, sqrt, length, normalize, select, sign, atan, mod, reflect,
  uv, vertexColor, time, cameraProjectionMatrix, hash,
} = T
export type N = any
