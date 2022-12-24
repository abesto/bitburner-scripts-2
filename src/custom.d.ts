// Allow baking `.txt` files into scripts
declare module "*.txt" {
  const content: string;
  export default content;
}
