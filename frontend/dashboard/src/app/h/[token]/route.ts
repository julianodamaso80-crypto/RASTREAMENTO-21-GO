import { NextResponse } from 'next/server';

// Link curto do PDF do histórico (trackgo.site/h/<código>). O PDF mora na API;
// aqui só se encaminha, para o link que vai no WhatsApp ficar no domínio curto.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = (process.env.NEXT_PUBLIC_API_URL || 'https://api.trackgo.site').replace(/\/$/, '');
  return NextResponse.redirect(`${api}/h/${encodeURIComponent(token)}`, 307);
}
