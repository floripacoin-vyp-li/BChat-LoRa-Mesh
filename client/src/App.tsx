import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Firmware from "@/pages/firmware";
import Tutorial from "@/pages/tutorial";
import Admin from "@/pages/admin";
import { useScreenshotGuard } from "@/hooks/use-screenshot-guard";
import { ScreenshotGuard } from "@/components/screenshot-guard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard}/>
      <Route path="/firmware" component={Firmware}/>
      <Route path="/tutorial" component={Tutorial}/>
      <Route path="/admin" component={Admin}/>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { obscured } = useScreenshotGuard();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
        <ScreenshotGuard obscured={obscured} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
