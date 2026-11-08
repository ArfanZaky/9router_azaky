import { describe, it, expect } from "vitest";
import React from "react";
import { compileMotionCode } from "@/lib/motion/compile.js";

describe("compileMotionCode", () => {
  it("strips imports and returns the exported component", () => {
    const C = compileMotionCode(`
import { AbsoluteFill, useCurrentFrame } from "remotion";
import React from 'react';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: frame }}>Hi</AbsoluteFill>;
};`);
    expect(typeof C).toBe("function");
    expect(C.name).toBe("MyComposition");
  });

  it("accepts export default function and TypeScript annotations", () => {
    const C = compileMotionCode(`export default function Intro(): JSX.Element { const x: number = 1; return <div>{x}</div>; }`);
    expect(C.name).toBe("Intro");
    expect(React.isValidElement(C())).toBe(true);
  });

  it("throws on syntax errors and missing component", () => {
    expect(() => compileMotionCode("export const MyComposition = () => <div>")).toThrow();
    expect(() => compileMotionCode("const x = 1;")).toThrow(/not found/);
    expect(() => compileMotionCode("   ")).toThrow(/empty/);
  });
});
