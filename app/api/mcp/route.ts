import {
  handleHoodFlowMcpMethodNotAllowed,
  handleHoodFlowMcpOptions,
  handleHoodFlowMcpPost,
} from "@/lib/hoodflow-mcp-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleHoodFlowMcpPost(request);
}

export async function GET(request: Request) {
  return handleHoodFlowMcpMethodNotAllowed(request);
}

export async function DELETE(request: Request) {
  return handleHoodFlowMcpMethodNotAllowed(request);
}

export async function OPTIONS(request: Request) {
  return handleHoodFlowMcpOptions(request);
}
