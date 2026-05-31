export interface BalanceData {
  remaining_mb: number;
  remaining_gb: number;
  fullName?: string;
  phone?: string;
  address?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  nextPayment?: string;
  deposit?: string;
}

export interface UserSessionData {
  token: string;
  username: string;
  balance: BalanceData;
}

export type Language = "ar" | "en";

export interface TranslationSet {
  title: string;
  subtitle: string;
  titleLogo: string;
  loginCardTitle: string;
  usernameLabel: string;
  passwordLabel: string;
  usernamePlaceholder: string;
  passwordPlaceholder: string;
  loginButton: string;
  loggingInButton: string;
  requiredFieldsError: string;
  remainingDataLabel: string;
  gbLabel: string;
  mbLabel: string;
  refreshButton: string;
  refreshingStatus: string;
  updatedStatus: string;
  logoutButton: string;
  errorMessageTitle: string;
  connectionError: string;
  welcomeMessage: string;
  creditsLabel: string;
  toggleTheme: string;
  fullNameLabel: string;
  phoneLabel: string;
  addressLabel: string;
  statusLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  nextPaymentLabel: string;
  depositLabel: string;
}
