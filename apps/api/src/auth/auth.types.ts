export type JwtPayload = {
  sub: string;
  email: string;
  displayName: string;
};

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
};
