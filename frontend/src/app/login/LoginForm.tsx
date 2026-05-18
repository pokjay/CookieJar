"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(false);
    setLoading(true);
    const password = (
      e.currentTarget.elements.namedItem("password") as HTMLInputElement
    ).value;
    const result = await signIn("credentials", { password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError(true);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-xl">
        <h1 className="text-lg font-semibold text-gray-100 mb-1">
          Family Money Tracker
        </h1>
        <p className="text-sm text-gray-400 mb-6">
          Enter your password to continue
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm text-gray-400 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">
              Incorrect password. Try again.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
