"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import styles from "./public-auth-controls.module.css";

export function PublicAuthControls({ onNavigate }: { onNavigate?: () => void }) {
  const { isLoaded, isSignedIn } = useUser();
  return (
    <div className={styles.controls}>
      {isLoaded && isSignedIn ? (
        <>
          <Link prefetch={false} href="/cliente" className="account-link" onClick={onNavigate}>
            Minha conta
          </Link>
          <div className={styles.profile}>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: { width: 32, height: 32 },
                  userButtonTrigger: { minWidth: 44, minHeight: 44 },
                },
              }}
            />
            <span className={styles.profileLabel}>Perfil e sair</span>
          </div>
        </>
      ) : (
        <>
          <Link prefetch={false} href="/entrar" className="account-link" onClick={onNavigate}>
            Entrar
          </Link>
          <Link prefetch={false} href="/cadastro" className={styles.signup} onClick={onNavigate}>
            Criar conta
          </Link>
        </>
      )}
    </div>
  );
}
