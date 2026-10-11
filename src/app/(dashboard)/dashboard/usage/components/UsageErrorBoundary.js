"use client";

import React, { Component } from "react";
import { Card, Button } from "@/shared/components";

export default class UsageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Usage Dashboard Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="p-6 my-4 border-red-500/20 bg-red-500/5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-red-500 font-semibold">
              <span className="material-symbols-rounded">error</span>
              <span>Failed to load {this.props.title || "this section"}</span>
            </div>
            <p className="text-sm text-neutral-400">
              {this.state.error?.message || "An unexpected error occurred while rendering usage stats."}
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Retry
              </Button>
            </div>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
