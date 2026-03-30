type NexianLogoProps = {
  className?: string;
  priority?: "high" | "low" | "auto";
};

const logoUrl = "https://www.nexian.co.uk/hubfs/Nexian_2024/images/Logo-1.svg";

export function NexianLogo({ className, priority = "auto" }: NexianLogoProps) {
  return <img className={className} src={logoUrl} alt="Nexian" loading="eager" fetchPriority={priority} />;
}
