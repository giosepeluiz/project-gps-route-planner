import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = { title: "Entrar · Planejador de rotas" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <LoginForm />
    </main>
  );
}
