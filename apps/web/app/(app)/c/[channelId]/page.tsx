import { redirect } from "next/navigation";

export default async function ChannelIndex({ params }: { params: Promise<{ channelId: string }> }) {
  redirect(`/c/${(await params).channelId}/inicio`);
}
