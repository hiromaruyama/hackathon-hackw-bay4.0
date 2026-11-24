"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Bot, Building2, Home, KanbanSquare, MessageCircle, PenLine, RefreshCw, Share2, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActivityList, InlineAlert } from "@/components/signal";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoiceAssistant } from "@/components/voice-assistant";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/profile/", label: "Profile", icon: Target },
  { href: "/accounts/", label: "Accounts", icon: Building2 },
  { href: "/graph/", label: "Graph", icon: Share2 },
  { href: "/outreach/", label: "Outreach", icon: PenLine },
  { href: "/pipeline/", label: "Pipeline", icon: KanbanSquare },
];

const CHAT = { href: "/chat/", label: "Chat", icon: MessageCircle };

export function AppShell({ commands, children }: { commands?: React.ReactNode; children: React.ReactNode }) {
  const { status, mode, loadError, refresh, workspace } = useWorkspace();
  const pathname = usePathname();
  const chat = pathname === CHAT.href;
  const isHome = pathname === "/";
  const showWorkspace = status === "ready" && workspace !== null;
  const fullPageChat = (isHome || chat) && showWorkspace;

  return (
    <div className={cn("flex min-h-screen flex-col", fullPageChat && "h-dvh min-h-dvh overflow-hidden")}>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-topbar px-4 text-foreground">
        <Link href="/" className="flex items-center gap-2.5 text-[19px] font-bold whitespace-nowrap text-foreground no-underline hover:text-foreground">
          <Bot aria-hidden size={23} className="text-primary">
            <path d="M10.5 16.5q1.5 2 3 0" />
          </Bot>
          Signal
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {status === "ready" && workspace ? <ActivitySheet /> : null}
          <ThemeToggle />
          {mode === "sample" ? (
            <Badge variant="outline">Sample data</Badge>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Main" className="flex shrink-0 border-b bg-subtle md:w-[76px] md:flex-col md:border-r md:border-b-0 md:py-2">
          <div className="flex min-w-0 flex-1 overflow-x-auto md:flex-none md:flex-col md:overflow-visible">
            {NAV.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />
            ))}
          </div>
          <NavLink item={CHAT} active={chat} className="border-l md:sticky md:bottom-0 md:mt-auto md:border-t md:border-l-0" />
        </nav>

        <div className={cn("flex min-w-0 flex-1 flex-col", fullPageChat && "min-h-0")}>
          {commands ? (
            <div role="toolbar" aria-label="Commands" className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-4">
              {commands}
            </div>
          ) : null}
          <main className={cn("mx-auto flex w-full max-w-[1280px] flex-col gap-6 p-4 md:p-6", fullPageChat && "min-h-0 flex-1", isHome && showWorkspace && "max-w-none gap-0 p-0 md:p-0")}>
            {status === "ready" && loadError ? (
              <InlineAlert tone="danger" title="Couldn't refresh the workspace" action={<Button variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button>}>
                {loadError.message} You're seeing the last saved view.
              </InlineAlert>
            ) : null}
            {status === "loading" ? <LoadingView /> : null}
            {status === "signin" ? <SignIn /> : null}
            {status === "error" ? (
              <InlineAlert tone="danger" title="Couldn't load your workspace" action={<Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw /> Retry</Button>}>
                {loadError?.message ?? "The server didn't respond."}
              </InlineAlert>
            ) : null}
            {showWorkspace ? children : null}
          </main>
          {showWorkspace && !fullPageChat ? <VoiceAssistant /> : null}
        </div>
      </div>
    </div>
  );
}

function NavLink({ item: { href, label, icon: Icon }, active, className }: { item: typeof CHAT; active: boolean; className?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-[72px] shrink-0 flex-col items-center gap-1 px-1 py-2.5 text-xs text-muted-foreground no-underline hover:bg-muted hover:text-foreground",
        active && "bg-accent font-bold text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.8} />
      {label}
    </Link>
  );
}

function ActivitySheet() {
  const { workspace, mode, pending, refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || mode === "sample" || pending) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [open, mode, pending, refresh]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm"><Activity data-icon="inline-start" />Activity</Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0">
        <SheetHeader>
          <SheetTitle>Workspace activity</SheetTitle>
          <SheetDescription>Recorded research, graph checks, review decisions, and provider outcomes.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <ActivityList events={workspace?.activity ?? []} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export function CommandLink({ icon: Icon, href, children }: { icon?: React.ElementType; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 rounded-md px-2.5 text-sm font-normal text-foreground no-underline")}>
      {Icon ? <Icon aria-hidden className="text-link" /> : null}
      {children}
    </Link>
  );
}

function LoadingView() {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className="flex flex-col gap-6">
      <Skeleton className="h-28 rounded-lg bg-card" />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg bg-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg bg-card" />
    </div>
  );
}

function SignIn() {
  const { signIn } = useWorkspace();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter the demo password.");
      return;
    }
    setBusy(true);
    const res = await signIn(password);
    setBusy(false);
    if (!res.ok) setError(res.error?.status === 401 ? "That password didn't work. Check it and try again." : res.error?.message ?? "Couldn't sign in. Try again.");
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-12 flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold">Sign in to Signal</h1>
        <p className="text-muted-foreground">Use the demo password your team shared with you.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Demo password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-error" : undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={busy} className="h-10">
        {busy ? <Spinner /> : null}
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
