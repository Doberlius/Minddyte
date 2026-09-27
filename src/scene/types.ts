/**
 * A scene as plain data: what the model's code (in the worker) describes and
 * the frame's renderer draws. Scene units: x in [-8, 8], y in [-4.5, 4.5], y up.
 */
export type Vec = [number, number]
export type Poly = { kind: 'poly'; points: Vec[]; closed: boolean; stroke: string; width: number; fill: string | null }
export type Circle = { kind: 'circle'; c: Vec; r: number; stroke: string | null; width: number; fill: string | null }
export type Label = { kind: 'label'; at: Vec; text: string; tex: boolean; color: string; size: number }
export type Shape = Poly | Circle | Label

/** create: fade/trace in. fadeOut: fade away. change: interpolate a shape to `to`. */
export type Op = { op: 'create'; ids: string[] } | { op: 'fadeOut'; ids: string[] } | { op: 'change'; id: string; to: Shape }
export type Step = { ops: Op[]; duration: number; caption: string | null }
export type SliderDef = { name: string; min: number; max: number; value: number; step: number }
export type Scene = { title: string | null; shapes: Record<string, Shape>; steps: Step[]; sliders: SliderDef[] }

export const LIMITS = { shapes: 400, steps: 60, sliders: 8, scenesPerReply: 2 } as const
export const BACKGROUND = '#0E0E10'
