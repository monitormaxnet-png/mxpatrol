import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Lock, ArrowRight, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";
import { MxPatrolVideoBackground } from "@/components/branding/MxPatrolVideoBackground";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useLayoutEffect(() => {
    panelBodyRef.current?.toggleAttribute("inert", !expanded);
  }, [expanded]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setExpanded(true);
      setLoginError(error.message);
      toast.error("Login failed", { description: error.message });
    } else {
      navigate("/dashboard");
    }
    setLoading(false);
  };

  return (
    <MxPatrolVideoBackground shellClassName="mx-login" shadeClassName="mx-login-background-shade">
      <main className="mx-login-interface">
        <section className="login-form-content mx-login-panel" data-expanded={expanded} aria-label="Sign in">
          <button
            type="button"
            className="mx-login-panel__trigger"
            aria-label={expanded ? "Collapse sign-in panel" : "Expand sign-in panel"}
            aria-expanded={expanded}
            aria-controls="mx-login-panel-fields"
            disabled={loading}
            onClick={() => setExpanded((value) => !value)}
          >
            <TTechMxPatrolLogo variant="login" priority className="mx-login-panel__logo" decorative />
            <span className="mx-login-panel__title"><Lock aria-hidden="true" size={15} /> Sign In</span>
            <ChevronDown className="mx-login-panel__chevron" aria-hidden="true" size={17} />
          </button>

          <div ref={panelBodyRef} id="mx-login-panel-fields" className="mx-login-panel__body" aria-hidden={!expanded}>
            <div className="mx-login-panel__body-inner">
              <form onSubmit={handleLogin} className="mx-login-panel__form">
                <div className="mx-login-panel__field">
                  <label htmlFor="mx-login-email">Email</label>
                  <div className="mx-login-panel__input-wrap">
                    <Mail aria-hidden="true" className="mx-login-panel__input-icon" size={16} />
                    <Input
                      id="mx-login-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@company.com"
                      className="login-input pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="mx-login-panel__field">
                  <div className="mx-login-panel__field-heading">
                    <label htmlFor="mx-login-password">Password</label>
                    <Link to="/forgot-password" className="mx-login-panel__link">Forgot password?</Link>
                  </div>
                  <div className="mx-login-panel__input-wrap">
                    <Lock aria-hidden="true" className="mx-login-panel__input-icon" size={16} />
                    <Input
                      id="mx-login-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="login-input pl-10 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="mx-login-panel__visibility"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {loginError && <p className="mx-login-panel__error" role="alert">{loginError}</p>}

                <Button type="submit" disabled={loading} className="sign-in-button">
                  {loading ? "Signing in..." : "Sign In"}
                  <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </form>

              <p className="login-request-access">
                Don't have an account? <Link to="/signup" className="mx-login-panel__link">Request access</Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </MxPatrolVideoBackground>
  );
};

export default Login;









