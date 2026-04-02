import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Phone, User, Bot, Clock, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsAppConversations, useWhatsAppMessages, useWhatsAppRealtimeSubscription } from "@/hooks/useWhatsAppData";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";

const messageTypeConfig: Record<string, { label: string; color: "default" | "destructive" | "secondary" | "outline" }> = {
  text: { label: "Text", color: "secondary" },
  alert: { label: "Alert", color: "destructive" },
  status_query: { label: "Status Query", color: "default" },
  incident_report: { label: "Incident", color: "destructive" },
  system: { label: "AI Response", color: "outline" },
};

const WhatsApp = () => {
  useWhatsAppRealtimeSubscription();
  const { data: conversations = [], isLoading: convsLoading } = useWhatsAppConversations();
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const { data: messages = [], isLoading: msgsLoading } = useWhatsAppMessages(selectedConv);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConversation = conversations.find((c) => c.id === selectedConv);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          WhatsApp AI Assistant
        </h2>
        <p className="text-sm text-muted-foreground">
          AI-powered security communications via WhatsApp
        </p>
      </div>

      {/* Setup info banner */}
      <Card className="glass-card border-primary/20">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-foreground">WhatsApp Integration Setup</p>
            <p className="mt-1 text-muted-foreground">
              Connect Twilio in project settings to enable WhatsApp messaging. Configure your Twilio WhatsApp sandbox
              number and set the webhook URL to:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                {`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`}
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3" style={{ height: "calc(100vh - 280px)" }}>
        {/* Conversation list */}
        <Card className="glass-card lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Conversations ({conversations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-380px)]">
              {convsLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground text-center">
                    No conversations yet. Messages will appear here when guards message the WhatsApp number.
                  </p>
                </div>
              ) : (
                <div className="space-y-1 px-2">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConv(conv.id)}
                      className={`w-full rounded-lg p-3 text-left transition-colors ${
                        selectedConv === conv.id
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {(conv as any).guards?.full_name || conv.phone_number}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {conv.phone_number}
                            </p>
                          </div>
                        </div>
                        <Badge variant={conv.is_active ? "default" : "secondary"} className="text-[9px]">
                          {conv.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Last activity: {format(new Date(conv.updated_at), "PPp")}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Messages view */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {selectedConversation ? (
                <>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <span className="text-foreground">
                      {(selectedConversation as any).guards?.full_name || selectedConversation.phone_number}
                    </span>
                    {(selectedConversation as any).guards?.badge_number && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        Badge: {(selectedConversation as any).guards.badge_number}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">Select a conversation</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col p-0" style={{ height: "calc(100vh - 380px)" }}>
            <ScrollArea className="flex-1 p-4">
              {!selectedConv ? (
                <div className="flex h-full flex-col items-center justify-center py-16">
                  <MessageSquare className="mb-3 h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Select a conversation to view messages</p>
                </div>
              ) : msgsLoading ? (
                <div className="text-center text-sm text-muted-foreground py-8">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">No messages in this conversation</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isInbound = msg.direction === "inbound";
                    const typeConf = messageTypeConfig[msg.message_type] || messageTypeConfig.text;

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                            isInbound
                              ? "bg-muted/60 rounded-tl-sm"
                              : "bg-primary/10 border border-primary/20 rounded-tr-sm"
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            {isInbound ? (
                              <User className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <Bot className="h-3 w-3 text-primary" />
                            )}
                            <Badge variant={typeConf.color} className="text-[8px] px-1.5 py-0">
                              {typeConf.label}
                            </Badge>
                          </div>
                          <div className="prose prose-sm max-w-none text-sm text-foreground dark:prose-invert">
                            <ReactMarkdown>{msg.message_body}</ReactMarkdown>
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {format(new Date(msg.created_at), "HH:mm")}
                            {msg.twilio_sid && (
                              <span className="ml-1 text-primary/60">✓ Delivered</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default WhatsApp;
