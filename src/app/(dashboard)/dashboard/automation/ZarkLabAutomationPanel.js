"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import {
  BulkAccountAutomationModal,
  Card,
} from "@/shared/components";

export default function ZarkLabAutomationPanel({ onRefresh }) {
  const [isBulkOpen, setIsBulkOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsBulkOpen(true)}
          className="text-left"
        >
          <Card
            hover
            padding="md"
            icon="group_add"
            title="Auto Login Bulk (Google SSO)"
            subtitle="Run bulk Gmail:password or GSuite automation via Google SSO to authenticate ZarkLab AI and harvest API session tokens."
          />
        </button>
      </div>

      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="zarklab"
        title="ZarkLab AI Bulk GSuite Login"
        serviceName="ZarkLab AI"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
    </>
  );
}

ZarkLabAutomationPanel.propTypes = {
  onRefresh: PropTypes.func,
};
