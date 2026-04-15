import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  FormLayout,
  TextField,
  Select,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({
    settings: { maxNameLength: "20", maxNumber: "99", fontStyle: "block" },
  });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  // In production: save to DB here
  return redirect("/app/settings?saved=true");
};

export default function Settings() {
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const [maxNameLength, setMaxNameLength] = useState(settings.maxNameLength);
  const [maxNumber, setMaxNumber] = useState(settings.maxNumber);
  const [fontStyle, setFontStyle] = useState(settings.fontStyle);

  const handleSave = useCallback(() => {
    submit({ maxNameLength, maxNumber, fontStyle }, { method: "post" });
  }, [maxNameLength, maxNumber, fontStyle, submit]);

  return (
    <Page
      title="Settings"
      primaryAction={{ content: "Save", onAction: handleSave, loading: saving }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Customizer Limits</Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Max name length (characters)"
                    type="number"
                    value={maxNameLength}
                    onChange={setMaxNameLength}
                    min={1}
                    max={30}
                    helpText="Recommended: 15–20"
                  />
                  <TextField
                    label="Max jersey number"
                    type="number"
                    value={maxNumber}
                    onChange={setMaxNumber}
                    min={1}
                    max={999}
                    helpText="Most sports use 1–99"
                  />
                </FormLayout.Group>
                <Select
                  label="Preview font style"
                  options={[
                    { label: "Block (Impact)", value: "block" },
                    { label: "Athletic Italic", value: "italic" },
                    { label: "Serif", value: "serif" },
                  ]}
                  value={fontStyle}
                  onChange={setFontStyle}
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">How Orders Work</Text>
              <Text tone="subdued">
                The name and number are saved as <strong>line item properties</strong> on
                every order. You'll see "Player Name" and "Jersey Number" next to each
                jersey in your Orders dashboard.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
