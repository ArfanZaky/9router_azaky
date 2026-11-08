// Remotion entry point for server-side rendering (bundled by @remotion/bundler).
// One composition; size/fps/duration and the component code come from inputProps.
import React, { useMemo } from "react";
import { Composition, registerRoot } from "remotion";
import { compileMotionCode } from "./compile.js";

const Dynamic = ({ code }) => {
  const Component = useMemo(() => compileMotionCode(code), [code]);
  return React.createElement(Component);
};

const Root = () =>
  React.createElement(Composition, {
    id: "Dynamic",
    component: Dynamic,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 150,
    defaultProps: { code: "", width: 1920, height: 1080, fps: 30, durationInFrames: 150 },
    calculateMetadata: ({ props }) => ({
      width: props.width,
      height: props.height,
      fps: props.fps,
      durationInFrames: props.durationInFrames,
    }),
  });

registerRoot(Root);
