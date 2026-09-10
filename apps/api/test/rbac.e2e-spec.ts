import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * Permission tests generated loosely from the RBAC matrix (blueprint §11) —
 * not the full role x endpoint cross-product the blueprint calls for
 * eventually, but a real check per boundary this build actually enforces:
 * unauthenticated is rejected, a role without a grant is rejected, a role
 * with the grant succeeds. Extend this file as new endpoints land.
 */
describe("RBAC (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request", async () => {
    await request(app.getHttpServer()).get("/api/projects").expect(401);
  });

  it("rejects an invalid login", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "anant.sharma@ammbrands.in", password: "wrong-password" })
      .expect(401);
  });

  it("Sales role cannot read invoices (no invoices:view grant)", async () => {
    const token = await loginAs(app, "ananya.joshi@ammbrands.in"); // Sales Manager
    await request(app.getHttpServer())
      .get("/api/invoices")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("Finance role can read invoices", async () => {
    const token = await loginAs(app, "neha.agarwal@ammbrands.in"); // Finance Manager
    const res = await request(app.getHttpServer()).get("/api/invoices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("Sales role can read leads (CRM is theirs)", async () => {
    const token = await loginAs(app, "ananya.joshi@ammbrands.in");
    const res = await request(app.getHttpServer()).get("/api/leads").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("Founder (all-city grant) can read every city", async () => {
    const token = await loginAs(app, "anant.sharma@ammbrands.in");
    const res = await request(app.getHttpServer()).get("/api/cities").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(6);
  });

  it("a city-scoped user only sees their own city's projects", async () => {
    // Rohit Meena (u3) is scoped to Udaipur only.
    const token = await loginAs(app, "rohit.meena@ammbrands.in");
    const res = await request(app.getHttpServer()).get("/api/projects").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const cityNames = new Set(res.body.map((p: { city: { name: string } }) => p.city.name));
    expect(cityNames.size).toBeGreaterThan(0);
    expect([...cityNames]).toEqual(["Udaipur"]);
  });
});
