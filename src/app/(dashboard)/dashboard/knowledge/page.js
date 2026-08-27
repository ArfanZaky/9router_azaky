import KnowledgePageClient from "./KnowledgePageClient";

export const metadata = {
  title: "Knowledge Base - 9Router",
  description: "Upload documents, build knowledge bases, and enable RAG-powered AI chat with your own data",
};

export default function KnowledgePage() {
  return <KnowledgePageClient />;
}
