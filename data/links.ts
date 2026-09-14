export type LinkCategory = "llm" | "vpn" | "other";

export interface Link {
  id: string;
  name: string;
  description: string;
  url: string;
  category: LinkCategory;
  rebate?: string;
  sort?: number;
  updatedAt?: string;
}

export const CATEGORY_ORDER: LinkCategory[] = ["llm", "vpn", "other"];

export const CATEGORY_LABELS: Record<LinkCategory, string> = {
  llm: "大模型",
  vpn: "网络工具",
  other: "其他",
};

export const links: Link[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "国内可用的大模型 API，价格低廉",
    url: "https://example.com/invite/deepseek",
    category: "llm",
    rebate: "注册即送额度",
    sort: 100,
    updatedAt: "2026-09-14",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "ChatGPT / GPT 系列 API",
    url: "https://example.com/invite/openai",
    category: "llm",
    rebate: "邀请返利",
    sort: 90,
  },
  {
    id: "vpn-demo",
    name: "示例网络工具",
    description: "占位示例，请替换为真实服务与邀请链接",
    url: "https://example.com/invite/vpn",
    category: "vpn",
    rebate: "邀请返利",
    sort: 80,
  },
  {
    id: "other-demo",
    name: "示例其他",
    description: "占位示例，请替换为真实内容",
    url: "https://example.com/invite/other",
    category: "other",
  },
];
