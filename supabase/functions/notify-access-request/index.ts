Deno.serve(async (req) => {
  try {
    const { record } = await req.json();
    if (!record?.uuid || record.approved) return new Response("skip", { status: 200 });

    const name = [record.first_name, record.last_name].filter(Boolean).join(" ") || "Someone";
    const appUrl = Deno.env.get("APP_URL") ?? "";

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("FROM_EMAIL") ?? "Family Tree <onboarding@resend.dev>",
        to: Deno.env.get("OWNER_EMAIL"),
        subject: `${name} is requesting access to your family tree`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55;color:#15151a">
          <p><strong>${name}</strong>${record.email ? ` (${record.email})` : ""} just signed in and is waiting for your approval.</p>
          <p>Open <a href="${appUrl}">your family tree</a>, tap <strong>Members</strong>, and choose <strong>Approve</strong> &mdash; or leave them pending.</p>
        </div>`,
      }),
    });

    return new Response(r.ok ? "sent" : `resend error ${r.status}`, { status: r.ok ? 200 : 500 });
  } catch (e) {
    return new Response(`error: ${(e as Error).message}`, { status: 500 });
  }
});
