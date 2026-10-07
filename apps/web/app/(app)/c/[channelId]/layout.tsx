import { getChannelContext } from "@/lib/auth";

export default async function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ channelId: string }>;
}) {
  // 404 temprano si el canal no existe o no hay acceso.
  await getChannelContext((await params).channelId);
  return children;
}
