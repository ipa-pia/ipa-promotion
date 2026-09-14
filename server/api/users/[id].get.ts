export default defineApiHandler((event) => {
  const id = getRouterParam(event, "id");
  if (id?.includes(".")) {
    throw new Error("id is required");
  }
  return {
    id,
    name: "andy",
    age: 20,
  };
});
