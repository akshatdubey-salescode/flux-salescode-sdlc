"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : "";
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/`;
}

const APP_NAME = "salescode_internal_app";
const APP_VERSION = "1.0.0";

export const SALESCODE_TOKEN_KEY = "salescode_access_token";
export const SALESCODE_TOKEN_EXPIRY_KEY = "salescode_token_expiry";

function getDeviceId(): string {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("device_id", id);
  }
  return id;
}

function SalescodeCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const scope = searchParams.get("scope") ?? "";
    const authuser = searchParams.get("authuser") ?? "0";
    const hd = searchParams.get("hd") ?? "";
    const prompt = searchParams.get("prompt") ?? "none";
    const redirectBack = getCookie("salescode_redirect_back") || "/requirements/new";
    deleteCookie("salescode_redirect_back");

    if (!code || !state) {
      console.error("[salescode-callback] missing code or state");
      router.replace(redirectBack);
      return;
    }

    const queryParams = new URLSearchParams({ state, code, scope, authuser, hd, prompt });
    const tokenUrl = `/api/auth/salescode/token?${queryParams}`;

    const deviceInfo = {
      deviceId: getDeviceId(),
      platformType: "web",
      platformVersion: navigator.userAgent,
      appName: APP_NAME,
      appVersion: APP_VERSION,
      deviceName: "Chrome",
      active: true,
    };

    fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deviceInfo),
    })
      .then((res) => {
        if (!res.ok) return res.text().then((t) => Promise.reject(t));
        return res.json();
      })
      .then((data) => {
        const { accessToken, accessTokenExpiresIn } = data.tokenInformation ?? {};
        if (accessToken) {
          localStorage.setItem(SALESCODE_TOKEN_KEY, accessToken);
          localStorage.setItem(
            SALESCODE_TOKEN_EXPIRY_KEY,
            String(Date.now() + (accessTokenExpiresIn ?? 3600) * 1000)
          );
        }
        router.replace(redirectBack);
      })
      .catch((err) => {
        console.error("[salescode-callback] token exchange failed:", err);
        router.replace(redirectBack);
      });
  }, [router, searchParams]);

  return null;
}

export default function SalescodeCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-zinc-500">Connecting to Salescode…</p>
      <Suspense>
        <SalescodeCallbackInner />
      </Suspense>
    </div>
  );
}
