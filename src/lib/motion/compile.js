// Shared by the dashboard preview (@remotion/player) and the server render bundle
// (remotionEntry.js), so preview and MP4 run the exact same compiled component.
// Keep imports relative/bare: the Remotion bundler does not know the "@/" alias.
import React from "react";
import * as Babel from "@babel/standalone";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  Series,
  interpolate,
  interpolateColors,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const SCOPE = {
  React,
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  Series,
  interpolate,
  interpolateColors,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
};

export const MOTION_API_NAMES = Object.keys(SCOPE);

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\sfrom\s+)?["'][^"']+["'];?/gm;

// Turns LLM/user source (a module with `export const MyComposition = () => ...`)
// into a React component. Imports are dropped; the APIs above are injected instead.
export function compileMotionCode(code) {
  let name = null;
  const source = String(code || "")
    .replace(IMPORT_RE, "")
    .replace(/export\s+default\s+function\s+(\w+)/, (_, n) => {
      name ??= n;
      return `function ${n}`;
    })
    .replace(/export\s+(?:const|let|function)\s+(\w+)/g, (m, n) => {
      name ??= n;
      return m.replace(/^export\s+/, "");
    })
    .replace(/^\s*export\s+default\s+\w+;?\s*$/gm, "");
  if (!source.trim()) throw new Error("Code is empty");
  name ||= "MyComposition";

  const { code: js } = Babel.transform(source, {
    filename: "motion.tsx",
    presets: [["react", { runtime: "classic" }], "typescript"],
  });

  const factory = new Function(
    ...MOTION_API_NAMES,
    `${js}\nreturn typeof ${name} !== "undefined" ? ${name} : undefined;`
  );
  const Component = factory(...MOTION_API_NAMES.map((k) => SCOPE[k]));
  if (typeof Component !== "function") {
    throw new Error(`Component "${name}" not found. Export it as: export const MyComposition = () => { ... }`);
  }
  return Component;
}
