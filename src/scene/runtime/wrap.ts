/**
 * The source of one worker run: the library, then the model's code between
 * the library's begin/end hooks. The code is part of the script itself, not
 * passed to eval/new Function, which the frame's CSP would refuse anyway.
 */
export function workerScript(workerSource: string, code: string, sliders: Record<string, number>): string {
  return (
    `${workerSource}\n;__minddyte_begin(${JSON.stringify(sliders)});\n` +
    `(function () {\n"use strict";\n${code}\n}).call(undefined);\n__minddyte_end();\n`
  )
}
