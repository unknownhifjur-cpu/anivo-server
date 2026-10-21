export function requireAdmin(request, response, next) {
  if (request.session?.user?.role !== "admin") {
    return response.status(403).json({ error: "Admin access is required." });
  }

  next();
}
