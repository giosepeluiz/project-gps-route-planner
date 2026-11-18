/**
 * Envio das estatísticas anônimas por e-mail, pela API da Resend
 * (POST https://api.resend.com/emails). Só texto puro: nada de HTML nem anexos,
 * então não há como o conteúdo virar página, script ou vírus. Destinatário fixo
 * (o autor); a cópia, quando pedida, vai em CC para o e-mail que a pessoa digitou.
 */
import { CircuitBreaker, withPolicy } from "./resilience";

export interface Mailer {
  send(message: { subject: string; text: string; cc: string | null }): Promise<boolean>;
}

type FetchFn = typeof fetch;

/** Destino padrão das estatísticas. */
export const REPORT_TO_DEFAULT = "rotas@arqueirover.de";

export function createResendMailer(
  apiKey: string,
  from: string,
  to: string,
  fetchFn: FetchFn = fetch,
): Mailer {
  const breaker = new CircuitBreaker("resend", 3, 60_000);
  return {
    async send({ subject, text, cc }) {
      try {
        const res = await withPolicy(breaker, (signal) =>
          fetchFn("https://api.resend.com/emails", {
            method: "POST",
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [to], ...(cc ? { cc: [cc] } : {}), subject, text }),
          }).then((r) => {
            if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
            return r;
          }),
          // Sem nova tentativa: um e-mail repetido é pior que um que não saiu.
          { retries: 0 },
        );
        return res.ok;
      } catch (err) {
        console.warn("Falha ao enviar as estatísticas:", err instanceof Error ? err.message : err);
        return false;
      }
    },
  };
}

/** Configurado quando há RESEND_API_KEY e REPORT_EMAIL_FROM (domínio verificado na Resend). */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer | null {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.REPORT_EMAIL_FROM?.trim();
  if (!key || !from) return null;
  return createResendMailer(key, from, env.REPORT_EMAIL_TO?.trim() || REPORT_TO_DEFAULT);
}
