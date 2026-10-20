import { Suspense } from "react";
import ChatPageClient from "./ChatPageClient";

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-text-muted text-sm">
          Loading chat…
        </div>
      }
    >
      <ChatPageClient />
    </Suspense>
  );
}
