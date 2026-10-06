import { createFileRoute } from "@tanstack/react-router";
import { Workbench } from "@/canvas/Workbench";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Workbench />;
}
