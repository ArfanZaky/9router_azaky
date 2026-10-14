import RedminePageClient from "./RedminePageClient";

export const metadata = {
  title: "Redmine Tasks - 9Router",
  description: "Live task monitoring and issue management from Profescipta Redmine",
};

export default function RedminePage() {
  return <RedminePageClient />;
}
